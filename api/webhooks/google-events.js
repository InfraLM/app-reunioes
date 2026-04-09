import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');
const { getUserEmailFromDirectory } = require('../lib/google');
const config = require('../lib/config');

// Duração do timer em milissegundos (100 minutos)
const TIMEOUT_MS = 100 * 60 * 1000;

/**
 * Agenda o processamento de timeout via Upstash QStash.
 * O QStash chama POST /api/cron/process-timeouts após TIMEOUT_MS,
 * eliminando a necessidade do Vercel Cron (plano Pro).
 *
 * Variáveis de ambiente necessárias:
 *   QSTASH_TOKEN  — token do Upstash QStash
 *   APP_URL       — URL pública da aplicação (ex: https://reuniao.lmedu.com.br)
 *
 * Se QSTASH_TOKEN não estiver configurado, o agendamento é silenciosamente ignorado
 * (útil em desenvolvimento local).
 */
async function scheduleTimeoutViaQStash(conferenceId) {
  const qstashToken = process.env.QSTASH_TOKEN;
  const appUrl = process.env.APP_URL;

  if (!qstashToken || !appUrl) {
    logger.warn('QStash não configurado (QSTASH_TOKEN ou APP_URL ausente). Timeout não agendado.', { conferenceId });
    return;
  }

  const targetUrl = `${appUrl}/api/cron/process-timeouts`;
  const delaySeconds = Math.floor(TIMEOUT_MS / 1000);

  try {
    const response = await fetch('https://qstash.upstash.io/v2/publish/' + encodeURIComponent(targetUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': `${delaySeconds}s`,
        'Upstash-Forward-Authorization': `Bearer ${process.env.CRON_SECRET || ''}`,
      },
      body: JSON.stringify({ conference_id: conferenceId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Falha ao agendar timeout via QStash', { conferenceId, status: response.status, error: errorText });
    } else {
      logger.info(`Timeout agendado via QStash para ${conferenceId} em ${delaySeconds}s`, { conferenceId });
    }
  } catch (error) {
    logger.error('Erro ao chamar QStash', { conferenceId, error: error.message });
  }
}

/**
 * Extrai o ID da conferência do payload do evento.
 * O local do ID varia dependendo do tipo de evento.
 */
function getConferenceIdFromEvent(event) {
  // Eventos de conferência (started, ended)
  if (event.conferenceRecord?.name) {
    return event.conferenceRecord.name;
  }
  // Eventos de artefatos: o ID está no prefixo do nome do recurso
  const artifactName = event.recording?.name || event.transcript?.name || event.smartNote?.name;
  if (artifactName) {
    const match = artifactName.match(/^(conferenceRecords\/[^/]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extrai o tipo e nome do artefato do evento.
 */
function getArtifactDetails(event) {
  if (event.eventType?.includes('recording')) return { type: 'recording', name: event.recording?.name };
  if (event.eventType?.includes('transcript')) return { type: 'transcript', name: event.transcript?.name };
  if (event.eventType?.includes('smartNote')) return { type: 'smartNote', name: event.smartNote?.name };
  return null;
}

/**
 * POST /api/webhooks/google-events
 * Recebe eventos do Google Workspace via Pub/Sub Push Subscription.
 *
 * O Google Pub/Sub envia um POST com o seguinte corpo:
 * {
 *   "message": {
 *     "data": "<base64 do payload do evento>",
 *     "attributes": {
 *       "ce-type": "google.workspace.meet.recording.v2.fileGenerated",
 *       "ce-subject": "//cloudidentity.googleapis.com/users/123456789",
 *       "ce-time": "2024-01-01T10:00:00Z"
 *     }
 *   }
 * }
 *
 * IMPORTANTE: Sempre retornar 2xx para evitar reenvios automáticos do Pub/Sub.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    logger.info('Payload recebido do Pub/Sub Push', { body: req.body });

    const { message } = req.body;
    if (!message) {
      logger.warn('Webhook recebido sem a estrutura esperada.', { body: req.body });
      return res.status(400).json({ error: 'Invalid Pub/Sub message format' });
    }

    // Decodificar o payload base64
    const eventData = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    const eventType = message.attributes['ce-type'];
    const subject = message.attributes['ce-subject'];
    const eventTime = message.attributes['ce-time'];

    const event = { ...eventData, eventType, subject, eventTime };

    logger.info('Evento decodificado', { eventType, subject, eventTime });

    // Extrair o ID da conferência
    const conferenceId = getConferenceIdFromEvent(event);
    if (!conferenceId) {
      logger.warn('conferenceId não encontrado no payload.', { payload: eventData });
      return res.status(200).send('Event ignored: no conferenceId found.');
    }

    // Resolver o e-mail do usuário via Admin SDK
    const userEmail = await getUserEmailFromDirectory(event.subject);
    if (!userEmail) {
      logger.warn(`E-mail não resolvido para subject: ${event.subject}`);
      return res.status(200).send('Event ignored: user email not found.');
    }

    // Verificar se o usuário está na lista de monitoramento
    if (!config.usersToMonitor.includes(userEmail)) {
      logger.info(`Usuário ${userEmail} não está na lista de monitoramento. Ignorando.`);
      return res.status(200).send('User not monitored.');
    }

    // Montar os dados de atualização do artefato
    const artifact = getArtifactDetails(event);
    const updateData = { last_event_at: new Date(eventTime) };

    if (artifact?.type === 'recording') {
      updateData.has_recording = true;
      updateData.recording_name = artifact.name;
      if (event.recording?.driveDestination?.exportUri) {
        updateData.recording_url = event.recording.driveDestination.exportUri;
      }
    } else if (artifact?.type === 'transcript') {
      updateData.has_transcript = true;
      updateData.transcript_name = artifact.name;
      if (event.transcript?.docsDestination?.exportUri) {
        updateData.transcript_url = event.transcript.docsDestination.exportUri;
      }
    } else if (artifact?.type === 'smartNote') {
      updateData.has_smart_note = true;
      updateData.smart_note_name = artifact.name;
      // exportUri é preferido; document (ID) é o fallback
      const smartNoteUrl = event.smartNote?.docsDestination?.exportUri
        || (event.smartNote?.docsDestination?.document
          ? `https://docs.google.com/document/d/${event.smartNote.docsDestination.document}/view`
          : null);
      if (smartNoteUrl) updateData.smart_note_url = smartNoteUrl;
    }

    const hasArtifact = !!artifact;
    const timeoutAt = new Date(Date.now() + TIMEOUT_MS);

    // Criar ou atualizar o registro de rastreamento no banco
    const tracking = await prisma.conferenceArtifactTracking.upsert({
      where: { conference_id: conferenceId },
      update: updateData,
      create: {
        conference_id: conferenceId,
        user_email: userEmail,
        status: hasArtifact ? 'waiting' : 'no_artifact',
        timeout_at: hasArtifact ? timeoutAt : null,
        first_event_at: new Date(eventTime),
        ...updateData,
      },
    });

    // Promover de 'no_artifact' para 'waiting' quando o primeiro artefato chega
    // e agendar o timeout via QStash (apenas na primeira transição)
    const isFirstArtifact = hasArtifact && tracking.status === 'no_artifact';
    if (isFirstArtifact) {
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: { status: 'waiting', timeout_at: timeoutAt },
      });
      logger.info(`Conferência ${conferenceId} promovida para 'waiting'. Agendando timeout.`);
      // Agendar o callback de timeout via QStash (sem Vercel Cron)
      await scheduleTimeoutViaQStash(conferenceId);
    }

    // Se é o primeiro evento de uma nova conferência com artefato, também agendar
    const isNewConferenceWithArtifact = hasArtifact && !tracking.id;
    if (isNewConferenceWithArtifact) {
      await scheduleTimeoutViaQStash(conferenceId);
    }

    logger.info(`Rastreamento atualizado para ${conferenceId}`, {
      id: tracking.id,
      status: isFirstArtifact ? 'waiting' : tracking.status,
      artifact: artifact?.type || 'none',
    });

    return res.status(200).send('Event processed successfully.');

  } catch (error) {
    logger.error('Erro ao processar webhook:', {
      message: error.message,
      stack: error.stack,
    });
    // Retornar 200 para o Pub/Sub não reenviar indefinidamente
    return res.status(200).json({ error: 'Failed to process event, but acknowledging to prevent retries.' });
  }
}
