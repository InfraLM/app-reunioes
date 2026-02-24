import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Importar módulos CommonJS
const logger = require('../../backend/src/utils/logger');
const prisma = require('../../lib/prisma.cjs');
const { getConferenceDetails, getRecording, getTranscript, getSmartNote, getUserEmailFromDirectory } = require('../../backend/src/api/google');
const { sendWebhook } = require('../../backend/src/api/webhook');
const { getUserEmail } = require('../../backend/src/services/userRegistry');

// Configuração
const config = require('../../backend/src/config');
const TIMEOUT_MS = 100 * 60 * 1000; // 100 minutos

/**
 * Endpoint para receber notificações Push do Google Pub/Sub.
 * Este handler é ativado sempre que o Google envia um evento de reunião.
 */
export default async function handler(req, res) {
  // 1. Validar o método da requisição
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // 2. Extrair a mensagem do corpo da requisição
    const pubSubMessage = req.body.message;

    if (!pubSubMessage || !pubSubMessage.data) {
      logger.warn('Recebida requisição Push inválida do Pub/Sub.');
      return res.status(400).send('Bad Request: Formato de mensagem inválido.');
    }

    // 3. Decodificar os dados do evento
    const eventDataString = Buffer.from(pubSubMessage.data, 'base64').toString('utf-8');
    const eventData = JSON.parse(eventDataString);
    const attributes = pubSubMessage.attributes || {};

    const eventType = attributes["ce-type"];
    const eventTime = attributes["ce-time"];

    logger.info("Event received from Pub/Sub Push", {
      eventType,
      subject: attributes["ce-subject"],
      eventTime,
      payload: eventData
    });

    // 4. Extrair informações do evento
    let resourceName = attributes["ce-subject"]; // Default (User ID)

    // Tenta extrair ID real do payload
    if (eventData.recording && eventData.recording.name) resourceName = eventData.recording.name;
    if (eventData.transcript && eventData.transcript.name) resourceName = eventData.transcript.name;
    if (eventData.smartNote && eventData.smartNote.name) resourceName = eventData.smartNote.name;

    // Extrair URLs diretamente do payload do Pub/Sub (Google inclui exportUri no evento)
    const recordingUrlFromEvent = eventData.recording?.driveDestination?.exportUri || null;
    const transcriptUrlFromEvent = eventData.transcript?.docsDestination?.exportUri || null;
    const smartNoteUrlFromEvent = eventData.smartNote?.docsDestination?.exportUri || null;

    logger.info("URLs extraídas do evento Pub/Sub", {
      recordingUrl: recordingUrlFromEvent,
      transcriptUrl: transcriptUrlFromEvent,
      smartNoteUrl: smartNoteUrlFromEvent
    });

    // Tenta extrair Conference ID
    const conferenceMatch = resourceName ? resourceName.match(/conferenceRecords\/([^\/]+)/) : null;
    const conferenceId = conferenceMatch ? `conferenceRecords/${conferenceMatch[1]}` : null;

    if (!conferenceId) {
      logger.warn("Could not parse conferenceId from resourceName.", { resourceName, attributes });
      return res.status(200).send('OK - No conference ID found');
    }

    // 5. Obter email do usuário via Google Directory API
    let userEmail = null;
    const subject = attributes["ce-subject"] || "";

    // Tentar extrair userId do subject (formato: users/123456789)
    if (subject) {
      try {
        userEmail = await getUserEmailFromDirectory(subject);
        if (userEmail) {
          logger.info(`Email do organizador encontrado: ${userEmail}`);
        } else {
          logger.warn(`Não foi possível obter email para: ${subject}`);
        }
      } catch (error) {
        logger.error(`Erro ao buscar email do usuário:`, error);
      }
    }

    // 6. Processar evento e atualizar estado no banco de dados
    await processEventServerless(
      conferenceId, eventType, resourceName, userEmail, eventData,
      recordingUrlFromEvent, transcriptUrlFromEvent, smartNoteUrlFromEvent
    );

    // 7. Enviar resposta de sucesso
    return res.status(200).send('Webhook processado com sucesso.');

  } catch (error) {
    logger.error('Falha ao processar o webhook do Pub/Sub:', error);
    return res.status(500).send('Internal Server Error');
  }
}

/**
 * Processa um evento do Pub/Sub em ambiente serverless
 * Usa o banco de dados para manter estado entre requisições
 */
async function processEventServerless(
  conferenceId, eventType, resourceName, userEmail, eventData,
  recordingUrlFromEvent, transcriptUrlFromEvent, smartNoteUrlFromEvent
) {
  try {
    // Buscar ou criar registro de rastreamento
    let tracking = await prisma.conferenceArtifactTracking.findUnique({
      where: { conference_id: conferenceId }
    });

    const now = new Date();
    const timeoutAt = new Date(now.getTime() + TIMEOUT_MS);

    if (!tracking) {
      // Criar novo registro
      tracking = await prisma.conferenceArtifactTracking.create({
        data: {
          conference_id: conferenceId,
          user_email: userEmail,
          timeout_at: timeoutAt,
          has_recording: eventType && eventType.includes("recording"),
          has_transcript: eventType && eventType.includes("transcript"),
          has_smart_note: eventType && eventType.includes("smartNote"),
          recording_name: eventType && eventType.includes("recording") ? resourceName : null,
          transcript_name: eventType && eventType.includes("transcript") ? resourceName : null,
          smart_note_name: eventType && eventType.includes("smartNote") ? resourceName : null,
          recording_url: recordingUrlFromEvent,
          transcript_url: transcriptUrlFromEvent,
          smart_note_url: smartNoteUrlFromEvent,
        }
      });
      logger.info(`Novo rastreamento criado para conferência: ${conferenceId}`);
    } else {
      // Atualizar registro existente
      const updateData = {
        last_event_at: now,
      };

      if (!tracking.user_email && userEmail) {
        updateData.user_email = userEmail;
      }

      if (eventType && eventType.includes("recording")) {
        updateData.has_recording = true;
        updateData.recording_name = resourceName;
        if (recordingUrlFromEvent) updateData.recording_url = recordingUrlFromEvent;
      }
      if (eventType && eventType.includes("transcript")) {
        updateData.has_transcript = true;
        updateData.transcript_name = resourceName;
        if (transcriptUrlFromEvent) updateData.transcript_url = transcriptUrlFromEvent;
      }
      if (eventType && eventType.includes("smartNote")) {
        updateData.has_smart_note = true;
        updateData.smart_note_name = resourceName;
        if (smartNoteUrlFromEvent) updateData.smart_note_url = smartNoteUrlFromEvent;
      }

      // Se estava em erro e chegou novo evento com artefato, resetar para waiting
      if (tracking.status === 'error') {
        updateData.status = 'waiting';
        logger.info(`Conferência ${conferenceId} resetada de 'error' para 'waiting' por novo evento`);
      }

      tracking = await prisma.conferenceArtifactTracking.update({
        where: { conference_id: conferenceId },
        data: updateData
      });
      logger.info(`Rastreamento atualizado para conferência: ${conferenceId}`);
    }

    // Verificar se todos os artefatos foram recebidos
    if (tracking.has_recording && tracking.has_transcript && tracking.has_smart_note) {
      logger.info(`Todos os artefatos recebidos para ${conferenceId}. Processando...`);
      await processCompleteConferenceServerless(tracking);
    } else {
      const missing = [];
      if (!tracking.has_recording) missing.push("Gravação");
      if (!tracking.has_transcript) missing.push("Transcrição");
      if (!tracking.has_smart_note) missing.push("Anotações");
      logger.info(`Aguardando artefatos para ${conferenceId}: ${missing.join(", ")}`);
    }

  } catch (error) {
    logger.error(`Erro ao processar evento serverless para ${conferenceId}:`, error);
    throw error;
  }
}

/**
 * Processa uma conferência completa (quando todos os artefatos foram recebidos)
 */
async function processCompleteConferenceServerless(tracking) {
  try {
    // Verificar se já foi processada
    if (tracking.status === 'complete' || tracking.status === 'processing') {
      logger.info(`Conferência ${tracking.conference_id} já está ${tracking.status}`);
      return;
    }

    // Marcar como em processamento
    await prisma.conferenceArtifactTracking.update({
      where: { id: tracking.id },
      data: { status: 'processing' }
    });

    // Usar email do tracking ou fallback para impersonatedUser
    const impersonatedEmail = tracking.user_email || config.google.impersonatedUser;
    const organizerEmail = tracking.user_email;

    // Validar se usuário está na lista de monitorados
    if (!organizerEmail) {
      logger.warn(`Email do usuário não identificado para: ${tracking.conference_id}`);
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: { status: 'ignored' }
      });
      return;
    }

    if (!config.usersToMonitor.includes(organizerEmail)) {
      logger.info(`Usuário ${organizerEmail} não está na lista de monitorados. Ignorando ${tracking.conference_id}.`);
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: { status: 'ignored' }
      });
      return;
    }

    logger.info(`Processando conferência ${tracking.conference_id} (email: ${organizerEmail})`);

    // Buscar detalhes da conferência (não-fatal: usa fallback se falhar)
    let conferenceDetails = null;
    try {
      conferenceDetails = await getConferenceDetails(tracking.conference_id, impersonatedEmail);
    } catch (error) {
      logger.warn(`Não foi possível buscar detalhes da conferência ${tracking.conference_id}: ${error.message}. Continuando com fallback.`);
    }

    // Função auxiliar para extrair links do objeto de artefato
    const getArtifactLink = (art) => {
      if (!art) return null;
      // Para Gravações (driveDestination) — exportUri é a URL permanente
      if (art.driveDestination && art.driveDestination.exportUri) {
        return art.driveDestination.exportUri;
      }
      // Para Transcrições e Notas (docsDestination) — exportUri é a URL permanente
      if (art.docsDestination && art.docsDestination.exportUri) {
        return art.docsDestination.exportUri;
      }
      return null;
    };

    // Buscar artefatos: usar URL já armazenada (do evento Pub/Sub) ou tentar via API
    let recordingUrl = tracking.recording_url || null;
    let transcriptUrl = tracking.transcript_url || null;
    let smartNoteUrl = tracking.smart_note_url || null;

    if (!recordingUrl && tracking.has_recording && tracking.recording_name) {
      try {
        const recording = await getRecording(tracking.recording_name, impersonatedEmail);
        recordingUrl = getArtifactLink(recording);
        logger.info(`URL de gravação obtida via API: ${recordingUrl}`);
      } catch (err) {
        logger.error(`Erro ao buscar gravação: ${err.message}`);
      }
    } else if (recordingUrl) {
      logger.info(`Usando URL de gravação do evento Pub/Sub: ${recordingUrl}`);
    }

    if (!transcriptUrl && tracking.has_transcript && tracking.transcript_name) {
      try {
        const transcript = await getTranscript(tracking.transcript_name, impersonatedEmail);
        transcriptUrl = getArtifactLink(transcript);
        logger.info(`URL de transcrição obtida via API: ${transcriptUrl}`);
      } catch (err) {
        logger.error(`Erro ao buscar transcrição: ${err.message}`);
      }
    } else if (transcriptUrl) {
      logger.info(`Usando URL de transcrição do evento Pub/Sub: ${transcriptUrl}`);
    }

    if (!smartNoteUrl && tracking.has_smart_note && tracking.smart_note_name) {
      try {
        const smartNote = await getSmartNote(tracking.smart_note_name, impersonatedEmail);
        smartNoteUrl = getArtifactLink(smartNote);
        logger.info(`URL de smart note obtida via API: ${smartNoteUrl}`);
      } catch (err) {
        logger.error(`Erro ao buscar anotações: ${err.message}`);
      }
    } else if (smartNoteUrl) {
      logger.info(`Usando URL de smart note do evento Pub/Sub: ${smartNoteUrl}`);
    }

    // Preparar payload
    const payload = {
      conference_id: tracking.conference_id,
      meeting_title: conferenceDetails?.space?.displayName || "Reunião do Google Meet",
      start_time: conferenceDetails?.startTime || null,
      end_time: conferenceDetails?.endTime || null,
      recording_url: recordingUrl,
      transcript_url: transcriptUrl,
      smart_notes_url: smartNoteUrl,
      account_email: organizerEmail,
    };

    logger.info(`Payload do webhook para ${tracking.conference_id}:`, {
      recording_url: payload.recording_url,
      transcript_url: payload.transcript_url,
      smart_notes_url: payload.smart_notes_url
    });

    // Enviar webhook
    await sendWebhook(payload);
    logger.info(`Webhook enviado com sucesso para ${tracking.conference_id}`);

    // Salvar reunião no banco de dados
    try {
      await prisma.eppReunioesGovernanca.create({
        data: {
          conference_id: tracking.conference_id,
          titulo_reuniao: payload.meeting_title,
          data_reuniao: payload.start_time ? new Date(payload.start_time) : null,
          hora_inicio: payload.start_time || null,
          hora_fim: payload.end_time || null,
          responsavel: payload.account_email,
          link_gravacao: payload.recording_url,
          link_transcricao: payload.transcript_url,
          link_anotacao: payload.smart_notes_url,
        }
      });
      logger.info(`Reunião ${tracking.conference_id} salva no banco de dados.`);
    } catch (dbError) {
      logger.error(`Erro ao salvar no banco: ${dbError.message}`);
    }

    // Marcar como completo
    await prisma.conferenceArtifactTracking.update({
      where: { id: tracking.id },
      data: {
        status: 'complete',
        processed_at: new Date()
      }
    });

  } catch (error) {
    logger.error(`Erro ao processar conferência completa ${tracking.conference_id}:`, error);
    await prisma.conferenceArtifactTracking.update({
      where: { id: tracking.id },
      data: { status: 'error' }
    });
    throw error;
  }
}
