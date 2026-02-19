const { PubSub } = require("@google-cloud/pubsub");
const config = require("../config");
const logger = require("../utils/logger");
const { getConferenceDetails, getGoogleDriveLink, getRecording, getTranscript, getSmartNote } = require("../api/google");
const { sendWebhook } = require("../api/webhook");
const { getUserEmail } = require("./userRegistry");

const pubsub = new PubSub({
    projectId: config.google.projectId,
    credentials: {
        client_email: config.google.serviceAccountEmail,
        private_key: config.google.privateKey,
    },
});
const subscription = pubsub.subscription(config.pubsub.subscriptionName);

// Armazenamento em memória para agrupar artefatos e estado da conferência
// Estrutura: { conferenceId: { startTime, timeoutTime, artifacts: { recording: bool, transcript: bool, smartNote: bool }, status: string, logs: [] } }
const conferencesStatus = {};

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos

function getConferenceStatus() {
    // Retorna uma cópia segura do estado para o frontend
    return Object.entries(conferencesStatus).map(([id, data]) => ({
        id: id.replace("conferenceRecords/", ""),
        startTime: data.startTime,
        timeoutTime: data.timeoutTime,
        artifacts: data.artifacts,
        status: data.status,
        userEmail: data.userEmail, // E-mail do proprietário
        progress: `${Object.values(data.artifacts).filter(Boolean).length}/3 Encontrados`, // 3 artefatos (Recording + Transcript + Smart Note)
        logs: data.logs
    }));
}

function updateConferenceLog(conferenceId, message) {
    if (conferencesStatus[conferenceId]) {
        conferencesStatus[conferenceId].logs.push(`[${new Date().toISOString()}] ${message}`);
    }
}

function processMessage(message) {
    try {
        const data = message.data ? Buffer.from(message.data, "base64").toString() : "{}";
        const payload = JSON.parse(data);
        const attributes = message.attributes || {};

        const eventTime = attributes["ce-time"]; // RFC3339 timestamp

        logger.info("Event received from Pub/Sub (Raw Data)", {
            eventType: attributes["ce-type"],
            subject: attributes["ce-subject"],
            eventTime: eventTime,
            payload: payload
        });

        const eventType = attributes["ce-type"];
        let resourceName = attributes["ce-subject"]; // Default (User ID)

        // Tenta extrair ID real do payload
        if (payload.recording && payload.recording.name) resourceName = payload.recording.name;
        if (payload.transcript && payload.transcript.name) resourceName = payload.transcript.name;
        if (payload.smartNote && payload.smartNote.name) resourceName = payload.smartNote.name;

        // Tenta extrair Conference ID
        const conferenceMatch = resourceName ? resourceName.match(/conferenceRecords\/([^\/]+)/) : null;
        const conferenceId = conferenceMatch ? `conferenceRecords/${conferenceMatch[1]}` : null;

        if (!conferenceId) {
            logger.warn("Could not parse conferenceId from resourceName. Acknowledging message.", { resourceName, attributes });
            message.ack();
            return;
        }

        if (conferenceId) {
            // Tenta obter o email do usuário associado ao evento para impersonação
            const userEmail = getUserEmail(attributes["ce-subject"] || "");

            // Inicializa estado se não existir
            if (!conferencesStatus[conferenceId]) {
                conferencesStatus[conferenceId] = {
                    startTime: Date.now(),
                    timeoutTime: Date.now() + TIMEOUT_MS,
                    artifacts: { recording: false, transcript: false, smartNote: false },
                    status: "waiting", // waiting, processing, complete, partial_complete
                    logs: [],
                    userEmail: userEmail, // Salva o email para uso posterior
                    timer: setTimeout(() => {
                        logger.info(`Timeout reached for conference: ${conferenceId}. Processing partial artifacts...`);
                        updateConferenceLog(conferenceId, "Timeout atingido (15min). Processando o que foi encontrado...");
                        processCompleteConference(conferenceId);
                    }, TIMEOUT_MS)
                };
                updateConferenceLog(conferenceId, "Primeiro evento recebido. Monitoramento iniciado.");
            }

            // Atualiza o email caso não tenha sido capturado no primeiro evento
            if (!conferencesStatus[conferenceId].userEmail && userEmail) {
                conferencesStatus[conferenceId].userEmail = userEmail;
            }

            // Atualiza artefatos encontrados
            if (eventType && eventType.includes("recording")) {
                conferencesStatus[conferenceId].artifacts.recording = true;
                conferencesStatus[conferenceId].recordingName = resourceName;
                updateConferenceLog(conferenceId, "Gravação recebida.");
            } else if (eventType && eventType.includes("transcript")) {
                conferencesStatus[conferenceId].artifacts.transcript = true;
                conferencesStatus[conferenceId].transcriptName = resourceName;
                updateConferenceLog(conferenceId, "Transcrição recebida.");
            } else if (eventType && eventType.includes("smartNote")) {
                conferencesStatus[conferenceId].artifacts.smartNote = true;
                conferencesStatus[conferenceId].smartNoteName = resourceName;
                updateConferenceLog(conferenceId, "Anotações inteligentes recebidas.");
            }

            // Verifica completude (Gravação + Transcrição + Anotações)
            const arts = conferencesStatus[conferenceId].artifacts;
            if (arts.recording && arts.transcript && arts.smartNote) {
                updateConferenceLog(conferenceId, "Todos os artefatos recebidos (3/3). Processando...");
                conferencesStatus[conferenceId].status = "processing";
                if (conferencesStatus[conferenceId].timer) clearTimeout(conferencesStatus[conferenceId].timer);
                processCompleteConference(conferenceId);
            } else {
                const missing = [];
                if (!arts.recording) missing.push("Gravação");
                if (!arts.transcript) missing.push("Transcrição");
                if (!arts.smartNote) missing.push("Anotações");
                updateConferenceLog(conferenceId, `Aguardando: ${missing.join(", ")}`);
            }
        }

        message.ack();
    } catch (error) {
        logger.error("Error processing Pub/Sub message", { error: error.message, stack: error.stack });
        message.nack(); // Re-enfileira a mensagem em caso de erro de processamento
    }
}

async function processCompleteConference(conferenceId) {
    const state = conferencesStatus[conferenceId];
    if (!state) {
        // Pode acontecer se processou via timeout E completou logo depois (race condition rara)
        return;
    }

    // Limpa timer se ainda existir
    if (state.timer) clearTimeout(state.timer);

    try {
        const impersonatedEmail = state.userEmail || config.google.impersonatedUser;
        const conferenceDetails = await getConferenceDetails(conferenceId, impersonatedEmail);

        // Na v2, o organizerEmail pode não vir no ConferenceRecord diretamente.
        // Usamos o email que capturamos no mapeamento de assinatura (state.userEmail)
        const organizerEmail = state.userEmail;

        if (!organizerEmail) {
            logger.warn(`User email not identified for conference: ${conferenceId}. Cannot verify user.`);
            updateConferenceLog(conferenceId, "Cancelado: E-mail do usuário não identificado.");
            state.status = "ignored";
            // Remove após um tempo para não poluir memória
            setTimeout(() => delete conferencesStatus[conferenceId], 3600000);
            return;
        }

        if (!config.usersToMonitor.includes(organizerEmail)) {
            logger.info(`User ${organizerEmail} is not in the monitored list. Ignoring conference ${conferenceId}.`);
            updateConferenceLog(conferenceId, "Cancelado: Usuário não monitorado.");
            state.status = "ignored";
            // Remove após um tempo para não poluir memória
            setTimeout(() => delete conferencesStatus[conferenceId], 3600000);
            return;
        }

        // Busca artefatos
        let recording, transcript, smartNote;

        if (state.artifacts.recording && state.recordingName) {
            try {
                recording = await getRecording(state.recordingName, impersonatedEmail);
            } catch (err) { logger.error(`Failed to fetch recording details: ${err.message}`); updateConferenceLog(conferenceId, `Erro ao buscar gravação: ${err.message}`); }
        }

        if (state.artifacts.transcript && state.transcriptName) {
            try {
                transcript = await getTranscript(state.transcriptName, impersonatedEmail);
            } catch (err) { logger.error(`Failed to fetch transcript details: ${err.message}`); updateConferenceLog(conferenceId, `Erro ao buscar transcrição: ${err.message}`); }
        }

        if (state.artifacts.smartNote && state.smartNoteName) {
            try {
                smartNote = await getSmartNote(state.smartNoteName, impersonatedEmail);
            } catch (err) { logger.error(`Failed to fetch smart note details: ${err.message}`); updateConferenceLog(conferenceId, `Erro ao buscar anotações: ${err.message}`); }
        }

        // Função auxiliar interna para extrair link de Drive ou Docs
        const getArtifactLink = (art) => {
            if (!art) return null;
            // Para Gravações (driveDestination)
            if (art.driveDestination && art.driveDestination.file) {
                return getGoogleDriveLink(art.driveDestination.file);
            }
            // Para Transcrições e Notas (docsDestination)
            if (art.docsDestination && art.docsDestination.document) {
                return getGoogleDriveLink(art.docsDestination.document);
            }
            return null;
        };

        const payload = {
            conference_id: conferenceId,
            meeting_title: conferenceDetails.space?.displayName || "Reunião do Google Meet",
            start_time: conferenceDetails.startTime,
            end_time: conferenceDetails.endTime,
            recording_url: getArtifactLink(recording),
            transcript_url: getArtifactLink(transcript),
            smart_notes_url: getArtifactLink(smartNote),
            account_email: organizerEmail,
        };

        await sendWebhook(payload);
        updateConferenceLog(conferenceId, "Webhook enviado com sucesso!");

        state.status = "complete";

    } catch (error) {
        logger.error(`Error processing complete conference: ${conferenceId}`, { error: error.message });
        updateConferenceLog(conferenceId, `Erro fatal: ${error.message}`);
        state.status = "error";
    } finally {
        // Mantém no histórico por 1 hora antes de limpar da memória
        setTimeout(() => delete conferencesStatus[conferenceId], 3600000);
    }
}

function startListening() {
    logger.info("\n" + "=".repeat(70));
    logger.info("🎧 STARTING PUB/SUB LISTENER");
    logger.info("=".repeat(70));
    logger.info(`Listener started at: ${new Date().toISOString()}`);
    logger.info(`Subscription: ${config.pubsub.subscriptionName}`);
    logger.info("Now processing all events from the subscription, regardless of when they occurred.");
    logger.info("=".repeat(70) + "\n");

    subscription.on("message", processMessage);
    logger.info(`✅ Listening for messages on subscription: ${config.pubsub.subscriptionName}`);
}

module.exports = { startListening, getConferenceStatus, processCompleteConference };
