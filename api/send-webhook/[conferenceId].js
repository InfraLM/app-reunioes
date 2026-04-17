import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');
const { sendWebhook } = require('../lib/webhook');

/**
 * POST /api/send-webhook/:conferenceId
 *
 * Envia o webhook final manualmente (botão "Enviar Agora" no painel).
 * Trabalha em cima de epp_meet_process: envia o payload com o que tiver gravado.
 */
export default async function handler(req, res) {
  // CORS
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];

  const origin = req.headers.origin;
  const isAllowed = corsOrigins.some((allowed) =>
    allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
  );
  if (isAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { conferenceId } = req.query;
    if (!conferenceId) {
      return res.status(400).json({ error: 'Conference ID é obrigatório' });
    }

    logger.info(`Envio manual de webhook solicitado para: ${conferenceId}`);

    const mp = await prisma.eppMeetProcess.findUnique({
      where: { conference_id: conferenceId },
    });

    if (!mp) {
      return res.status(404).json({ error: 'Meet não encontrada em epp_meet_process' });
    }

    const missing = [];
    if (!mp.has_recording) missing.push('recording');
    if (!mp.has_transcript) missing.push('transcript');
    if (!mp.has_smart_note) missing.push('smart_note');

    if (!mp.has_recording && !mp.has_transcript && !mp.has_smart_note) {
      return res.status(400).json({
        error: 'Nenhum artefato disponível para envio',
        message: 'A meet não tem gravação, transcrição ou smart notes',
      });
    }

    const payload = {
      conference_id: mp.conference_id,
      meeting_title: mp.meeting_title || 'Reunião do Google Meet',
      start_time: mp.meeting_start_time,
      end_time: mp.meeting_end_time,
      account_email: mp.user_email,
      recording_url: mp.recording_original_link,
      transcript_url: mp.transcript_original_link,
      smart_notes_url: mp.smart_note_original_link,
      drive_folder_link: mp.drive_folder_link,
      recording_drive_link: mp.recording_drive_link,
      transcript_drive_link: mp.transcript_drive_link,
      smart_note_drive_link: mp.smart_note_drive_link,
      manual_trigger: true,
      partial: missing.length > 0,
      missing_artifacts: missing,
    };

    await sendWebhook(payload);

    const finalStatus = missing.length === 0 ? 'complete' : 'partial';
    await prisma.eppMeetProcess.update({
      where: { conference_id: conferenceId },
      data: {
        status: finalStatus,
        updated_at: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Webhook enviado',
      payload: {
        conference_id: conferenceId,
        status: finalStatus,
        artifacts_sent: {
          recording: !!payload.recording_url,
          transcript: !!payload.transcript_url,
          smart_notes: !!payload.smart_notes_url,
        },
        drive_folder_link: payload.drive_folder_link,
        missing_artifacts: missing,
      },
    });
  } catch (error) {
    logger.error('Erro ao enviar webhook manualmente:', error);
    return res.status(500).json({ error: 'Erro ao processar requisição', message: error.message });
  }
}
