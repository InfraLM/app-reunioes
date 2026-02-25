import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../../backend/src/utils/logger');
const prisma = require('../../lib/prisma.cjs');
const { getUserEmailFromDirectory } = require('../../backend/src/api/google');
const config = require('../../backend/src/config');

/**
 * Extrai o ID da conferência do payload do evento.
 * O local do ID da conferência varia dependendo do tipo de evento.
 */
function getConferenceIdFromEvent(event) {
  // Para eventos diretos da conferência (started, ended)
  if (event.conferenceRecord?.name) {
    return event.conferenceRecord.name;
  }

  // Para eventos de artefatos (recording, transcript, etc.), o ID está na string do nome.
  const artifactName = event.recording?.name || event.transcript?.name || event.smartNote?.name;
  if (artifactName) {
    const match = artifactName.match(/^(conferenceRecords\/[^\/]+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extrai o nome do artefato e o tipo do evento.
 */
function getArtifactDetails(event) {
    if (event.eventType.includes('recording')) return { type: 'recording', name: event.recording?.name };
    if (event.eventType.includes('transcript')) return { type: 'transcript', name: event.transcript?.name };
    if (event.eventType.includes('smartNote')) return { type: 'smartNote', name: event.smartNote?.name };
    return null;
}


/**
 * POST /api/webhooks/google-events
 * Recebe eventos do Google Workspace via Pub/Sub Push.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Adicionado para logar o corpo completo do evento recebido do Pub/Sub.
    // Isso ajuda a depurar o payload exato que o Google está enviando.
    logger.info('Payload completo recebido do Pub/Sub Push', {
      body: req.body,
    });

    const { message } = req.body;

    if (!message) {
      logger.warn('Webhook recebido sem a estrutura esperada.', { body: req.body });
      return res.status(400).json({ error: 'Invalid Pub/Sub message format' });
    }

    // Decodificar dados do Pub/Sub
    const eventData = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    const eventType = req.headers['ce-type'];
    const subject = req.headers['ce-subject'];

    const event = { ...eventData, eventType, subject };

    logger.info("Event received from Pub/Sub Push", {
        eventType: event.eventType,
        subject: event.subject,
        payload: eventData,
        eventTime: req.headers['ce-time'],
    });

    // **LÓGICA CORRIGIDA**
    const conferenceId = getConferenceIdFromEvent(event);

    if (!conferenceId) {
        logger.warn('Could not parse conferenceId from event payload.', { payload: eventData });
        return res.status(200).send('Event ignored: no conferenceId found.');
    }

    const userEmail = await getUserEmailFromDirectory(event.subject);
    if (!userEmail) {
        logger.warn(`Could not resolve user email for subject: ${event.subject}`);
        return res.status(200).send('Event ignored: user email not found.');
    }

    // Verificar se o usuário está na lista de monitoramento
    if (!config.usersToMonitor.includes(userEmail)) {
        logger.info(`User ${userEmail} is not in the monitor list. Ignoring event.`);
        return res.status(200).send('User not monitored.');
    }

    // Dados para criar ou atualizar o registro de rastreamento
    const artifact = getArtifactDetails(event);
    const updateData = {
        last_event_at: new Date(event.eventTime),
    };

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
        if (event.smartNote?.docsDestination?.exportUri) {
            updateData.smart_note_url = event.smartNote.docsDestination.exportUri;
        }
    }

    // Timeout de 100 minutos a partir do primeiro evento
    const timeoutMinutes = 100;
    const timeoutAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);

    // Cria ou atualiza o registro da conferência
    const tracking = await prisma.conferenceArtifactTracking.upsert({
      where: { conference_id: conferenceId },
      update: updateData,
      create: {
        conference_id: conferenceId,
        user_email: userEmail,
        status: 'waiting',
        timeout_at: timeoutAt,
        ...updateData
      }
    });

    logger.info(`Conference artifact tracking updated for ${conferenceId}`, {
        id: tracking.id,
        new_data: updateData
    });

    return res.status(200).send('Event processed successfully.');

  } catch (error) {
    logger.error('Error processing webhook:', {
      message: error.message,
      stack: error.stack,
      body: req.body
    });
    // Retornar 2xx para o Pub/Sub não tentar reenviar indefinidamente
    return res.status(200).json({ error: 'Failed to process event, but acknowledging to prevent retries.' });
  }
}
