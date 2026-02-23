import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../../backend/src/utils/logger'); //
const prisma = require('../../lib/prisma.cjs'); //
const { getConferenceDetails, getRecording, getTranscript, getSmartNote, copyFileToSharedFolderAndGetLink } = require('../../backend/src/api/google'); //
const { sendWebhook } = require('../../backend/src/api/webhook'); //
const config = require('../../backend/src/config'); //

/**
 * POST /api/send-webhook/:conferenceId
 * Envia webhook manualmente (botão "Enviar Agora")
 * Envia com os artefatos disponíveis no momento
 */
export default async function handler(req, res) {
  // CORS
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];

  const origin = req.headers.origin;
  const isAllowed = corsOrigins.some(allowed =>
    allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
  );

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { conferenceId } = req.query;

    if (!conferenceId) {
      return res.status(400).json({ error: 'Conference ID é obrigatório' });
    }

    logger.info(`Envio manual de webhook solicitado para: ${conferenceId}`);

    // Buscar tracking no database
    const tracking = await prisma.conferenceArtifactTracking.findUnique({
      where: { conference_id: conferenceId }
    });

    if (!tracking) {
      logger.warn(`Conferência não encontrada: ${conferenceId}`);
      return res.status(404).json({ error: 'Conferência não encontrada' });
    }

    // Verificar se já foi processada
    if (tracking.status === 'complete' || tracking.status === 'partial_complete') {
      logger.info(`Conferência ${conferenceId} já foi processada (status: ${tracking.status})`);
      return res.status(200).json({
        message: 'Conferência já foi processada anteriormente',
        status: tracking.status
      });
    }

    // Marcar como em processamento
    await prisma.conferenceArtifactTracking.update({
      where: { id: tracking.id },
      data: { status: 'processing' }
    });

    const impersonatedEmail = tracking.user_email || config.google.impersonatedUser;
    const organizerEmail = tracking.user_email || 'unknown@meet.google.com';

    // Buscar detalhes da conferência
    let conferenceDetails;
    try {
      conferenceDetails = await getConferenceDetails(conferenceId, impersonatedEmail);
    } catch (error) {
      logger.error(`Erro ao buscar detalhes da conferência: ${error.message}`);
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: { status: 'error' }
      });
      return res.status(500).json({
        error: 'Erro ao buscar detalhes da conferência',
        message: error.message
      });
    }

    // Buscar artefatos que estão disponíveis
    let recording, transcript, smartNote;

    if (tracking.has_recording && tracking.recording_name) {
      try {
        recording = await getRecording(tracking.recording_name, impersonatedEmail);
        logger.info(`Gravação encontrada: ${tracking.recording_name}`);
      } catch (err) {
        logger.warn(`Não foi possível buscar gravação: ${err.message}`);
      }
    }

    if (tracking.has_transcript && tracking.transcript_name) {
      try {
        transcript = await getTranscript(tracking.transcript_name, impersonatedEmail);
        logger.info(`Transcrição encontrada: ${tracking.transcript_name}`);
      } catch (err) {
        logger.warn(`Não foi possível buscar transcrição: ${err.message}`);
      }
    }

    if (tracking.has_smart_note && tracking.smart_note_name) {
      try {
        smartNote = await getSmartNote(tracking.smart_note_name, impersonatedEmail);
        logger.info(`Smart Note encontrada: ${tracking.smart_note_name}`);
      } catch (err) {
        logger.warn(`Não foi possível buscar anotações: ${err.message}`);
      }
    }

    // Função auxiliar para extrair links
    const getArtifactLinkAndCopyToSharedFolder = async (art, impersonatedEmail, sharedFolderId) => {
      if (!art) return null;
      if (art.driveDestination && art.driveDestination.file) {
        return await copyFileToSharedFolderAndGetLink(art.driveDestination.file.id, impersonatedEmail, sharedFolderId);
      }
      if (art.docsDestination && art.docsDestination.document) {
        return await copyFileToSharedFolderAndGetLink(art.docsDestination.document.id, impersonatedEmail, sharedFolderId);
      }
      return null;
    };

    // Preparar payload com artefatos disponíveis
    const payload = {
      conference_id: conferenceId,
      meeting_title: conferenceDetails.space?.displayName || "Reunião do Google Meet",
      start_time: conferenceDetails.startTime, //
      end_time: conferenceDetails.endTime, //
      recording_url: await getArtifactLinkAndCopyToSharedFolder(recording, impersonatedEmail, config.google.sharedDriveFolderId),
      transcript_url: await getArtifactLinkAndCopyToSharedFolder(transcript, impersonatedEmail, config.google.sharedDriveFolderId),
      smart_notes_url: await getArtifactLinkAndCopyToSharedFolder(smartNote, impersonatedEmail, config.google.sharedDriveFolderId),
      account_email: organizerEmail,
      manual_trigger: true, // Indica que foi acionado manualmente
      partial: !(tracking.has_recording && tracking.has_transcript && tracking.has_smart_note),
      missing_artifacts: []
    };

    // Listar artefatos faltantes
    if (!tracking.has_recording) payload.missing_artifacts.push('recording');
    if (!tracking.has_transcript) payload.missing_artifacts.push('transcript');
    if (!tracking.has_smart_note) payload.missing_artifacts.push('smart_note');

    // Enviar webhook se houver pelo menos um artefato
    if (tracking.has_recording || tracking.has_transcript || tracking.has_smart_note) {
      await sendWebhook(payload);
      logger.info(`✅ Webhook enviado manualmente para ${conferenceId}`);

      // Salvar reunião no banco de dados (se ainda não foi salva)
      try {
        await prisma.eppReunioesGovernanca.upsert({
          where: { conference_id: conferenceId },
          update: {
            titulo_reuniao: payload.meeting_title,
            data_reuniao: payload.start_time ? new Date(payload.start_time) : null,
            hora_inicio: payload.start_time || null,
            hora_fim: payload.end_time || null,
            responsavel: payload.account_email,
            link_gravacao: payload.recording_url,
            link_transcricao: payload.transcript_url,
            link_anotacao: payload.smart_notes_url,
          },
          create: {
            conference_id: conferenceId,
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
        logger.info(`Reunião ${conferenceId} salva/atualizada no banco.`);
      } catch (dbError) {
        logger.error(`Erro ao salvar no banco: ${dbError.message}`);
      }

      // Marcar como completo ou partial_complete
      const finalStatus = payload.partial ? 'partial_complete' : 'complete';
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: {
          status: finalStatus,
          processed_at: new Date()
        }
      });

      return res.status(200).json({
        success: true,
        message: 'Webhook enviado com sucesso',
        payload: {
          conference_id: conferenceId,
          status: finalStatus,
          artifacts_sent: {
            recording: !!payload.recording_url,
            transcript: !!payload.transcript_url,
            smart_notes: !!payload.smart_notes_url
          },
          missing_artifacts: payload.missing_artifacts
        }
      });

    } else {
      // Nenhum artefato encontrado
      logger.warn(`Nenhum artefato disponível para ${conferenceId}`);
      await prisma.conferenceArtifactTracking.update({
        where: { id: tracking.id },
        data: { status: 'error' }
      });

      return res.status(400).json({
        error: 'Nenhum artefato disponível para envio',
        message: 'A conferência não possui gravação, transcrição ou anotações'
      });
    }

  } catch (error) {
    logger.error('Erro ao enviar webhook manualmente:', error);
    return res.status(500).json({
      error: 'Erro ao processar requisição',
      message: error.message
    });
  }
}
