import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../../backend/src/utils/logger');
const prisma = require('../../lib/prisma.cjs');
const { getConferenceDetails, getRecording, getTranscript, getSmartNote } = require('../../backend/src/api/google');
const { sendWebhook } = require('../../backend/src/api/webhook');
const config = require('../../backend/src/config');

/**
 * Endpoint para processar conferências que excederam o timeout
 * Pode ser chamado por um cron job (Vercel Cron, GitHub Actions, etc.)
 *
 * Configuração Vercel Cron em vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/process-timeouts",
 *     "schedule": "every 5 minutes"
 *   }]
 * }
 */
export default async function handler(req, res) {
  try {
    // Opcional: Validar token de autorização para segurança
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    logger.info('Iniciando processamento de timeouts...');

    // Buscar conferências que excederam o timeout e ainda não foram processadas
    const now = new Date();
    const timedOutConferences = await prisma.conferenceArtifactTracking.findMany({
      where: {
        timeout_at: {
          lte: now
        },
        status: 'waiting'
      }
    });

    logger.info(`Encontradas ${timedOutConferences.length} conferências com timeout`);

    const results = {
      processed: 0,
      errors: 0,
      ignored: 0
    };

    // Processar cada conferência
    for (const tracking of timedOutConferences) {
      try {
        logger.info(`Processando conferência com timeout: ${tracking.conference_id}`);
        await processTimedOutConference(tracking);
        results.processed++;
      } catch (error) {
        logger.error(`Erro ao processar ${tracking.conference_id}:`, error);
        results.errors++;
      }
    }

    logger.info('Processamento de timeouts concluído', results);

    return res.status(200).json({
      success: true,
      message: 'Processamento concluído',
      results
    });

  } catch (error) {
    logger.error('Erro no processamento de timeouts:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
}

/**
 * Processa uma conferência que excedeu o timeout
 * Envia webhook com os artefatos que foram encontrados
 */
async function processTimedOutConference(tracking) {
  try {
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
      logger.info(`Usuário ${organizerEmail} não está na lista de monitorados.`);
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: { status: 'ignored' }
      });
      return;
    }

    logger.info(`Processando timeout para ${tracking.conference_id} (email: ${organizerEmail})`);

    // Buscar detalhes da conferência
    let conferenceDetails;
    try {
      conferenceDetails = await getConferenceDetails(tracking.conference_id, impersonatedEmail);
    } catch (error) {
      logger.error(`Erro ao buscar detalhes da conferência: ${error.message}`);
      // Se não conseguir buscar detalhes, marca como erro e continua
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: { status: 'error' }
      });
      return;
    }

    // Buscar artefatos que foram encontrados
    let recording, transcript, smartNote;

    if (tracking.has_recording && tracking.recording_name) {
      try {
        recording = await getRecording(tracking.recording_name, impersonatedEmail);
      } catch (err) {
        logger.warn(`Não foi possível buscar gravação: ${err.message}`);
      }
    }

    if (tracking.has_transcript && tracking.transcript_name) {
      try {
        transcript = await getTranscript(tracking.transcript_name, impersonatedEmail);
      } catch (err) {
        logger.warn(`Não foi possível buscar transcrição: ${err.message}`);
      }
    }

    if (tracking.has_smart_note && tracking.smart_note_name) {
      try {
        smartNote = await getSmartNote(tracking.smart_note_name, impersonatedEmail);
      } catch (err) {
        logger.warn(`Não foi possível buscar anotações: ${err.message}`);
      }
    }

    // Função auxiliar para extrair links
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

    // Preparar payload com artefatos parciais
    const payload = {
      conference_id: tracking.conference_id,
      meeting_title: conferenceDetails.space?.displayName || "Reunião do Google Meet",
      start_time: conferenceDetails.startTime,
      end_time: conferenceDetails.endTime,
      recording_url: getArtifactLink(recording),
      transcript_url: getArtifactLink(transcript),
      smart_notes_url: getArtifactLink(smartNote),
      account_email: organizerEmail,
      partial: true, // Indica que é um processamento parcial
      missing_artifacts: []
    };

    // Listar artefatos faltantes
    if (!tracking.has_recording) payload.missing_artifacts.push('recording');
    if (!tracking.has_transcript) payload.missing_artifacts.push('transcript');
    if (!tracking.has_smart_note) payload.missing_artifacts.push('smart_note');

    // Enviar webhook apenas se houver pelo menos um artefato
    if (tracking.has_recording || tracking.has_transcript || tracking.has_smart_note) {
      await sendWebhook(payload);
      logger.info(`Webhook enviado (parcial) para ${tracking.conference_id}`);

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
        logger.info(`Reunião ${tracking.conference_id} salva no banco (parcial).`);
      } catch (dbError) {
        // Pode ser duplicate key se já foi processada
        logger.error(`Erro ao salvar no banco: ${dbError.message}`);
      }

      // Marcar como completo (parcial)
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: {
          status: 'partial_complete',
          processed_at: new Date()
        }
      });
    } else {
      // Nenhum artefato encontrado
      logger.warn(`Nenhum artefato encontrado para ${tracking.conference_id}`);
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: { status: 'error' }
      });
    }

  } catch (error) {
    logger.error(`Erro ao processar conferência com timeout ${tracking.conference_id}:`, error);
    await prisma.conferenceArtifactTracking.update({
      where: { id: tracking.id },
      data: { status: 'error' }
    });
    throw error;
  }
}
