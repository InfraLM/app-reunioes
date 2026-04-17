import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');
const { sendWebhook } = require('../lib/webhook');
const config = require('../lib/config');

/**
 * POST /api/cron/dispatch-webhook  body: { conference_id }
 *
 * Worker chamado pelo QStash. Faz o POST real para o n8n (WEBHOOK_DESTINATION_URL).
 * Atualiza status em epp_meet_status. Links ausentes vão como "".
 *
 * Protegido por CRON_SECRET.
 */
export default async function handler(req, res) {
  const startTime = Date.now();
  try {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { conference_id: conferenceId } = req.body || {};
    if (!conferenceId) return res.status(400).json({ error: 'conference_id é obrigatório' });

    logger.info(`[dispatch-webhook] iniciando ${conferenceId}`);

    // Marca como "enviando"
    await prisma.eppMeetStatus.update({
      where: { conference_id: conferenceId },
      data: { status: 'webhook_enviando', updated_at: new Date() },
    }).catch((e) => logger.warn('[dispatch] falha ao marcar enviando', { error: e.message }));

    // Carrega dados
    const [mp, ms] = await Promise.all([
      prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } }),
      prisma.eppMeetStatus.findUnique({ where: { conference_id: conferenceId } }),
    ]);

    if (!mp || !ms) {
      logger.error(`[dispatch-webhook] meet ${conferenceId} sem meet_process ou meet_status`);
      await prisma.eppMeetStatus.update({
        where: { conference_id: conferenceId },
        data: {
          status: 'webhook_erro',
          webhook_last_error: 'Meet sem meet_process ou meet_status',
          data_ultimo_erro: new Date(),
          updated_at: new Date(),
        },
      }).catch(() => {});
      return res.status(200).json({ ok: false, error: 'meet not found' });
    }

    const missing = [];
    if (!mp.has_recording) missing.push('recording');
    if (!mp.has_transcript) missing.push('transcript');
    if (!mp.has_smart_note) missing.push('smart_note');

    const durationMinutes =
      mp.meeting_start_time && mp.meeting_end_time
        ? Math.round(
            (new Date(mp.meeting_end_time).getTime() - new Date(mp.meeting_start_time).getTime()) /
              60000
          )
        : null;

    const payload = {
      conference_id: conferenceId,
      meeting_title: mp.meeting_title || 'Reunião do Google Meet',
      start_time: mp.meeting_start_time,
      end_time: mp.meeting_end_time,
      duration_minutes: durationMinutes,
      account_email: mp.user_email,
      drive_folder_link: mp.drive_folder_link || '',
      artefatos_completos: missing.length === 0,
      missing_artifacts: missing,
      artifacts: {
        recording: {
          present: !!mp.has_recording,
          copy_url: mp.recording_drive_link || '',
          original_url: mp.recording_original_link || '',
          file_id: mp.recording_drive_file_id || null,
        },
        transcript: {
          present: !!mp.has_transcript,
          copy_url: mp.transcript_drive_link || '',
          original_url: mp.transcript_original_link || '',
          file_id: mp.transcript_drive_file_id || null,
        },
        smart_note: {
          present: !!mp.has_smart_note,
          copy_url: mp.smart_note_drive_link || '',
          original_url: mp.smart_note_original_link || '',
          file_id: mp.smart_note_drive_file_id || null,
        },
      },
      // Campos legados — manter compat com workflows n8n existentes
      recording_url: mp.recording_drive_link || mp.recording_original_link || '',
      transcript_url: mp.transcript_drive_link || mp.transcript_original_link || '',
      smart_notes_url: mp.smart_note_drive_link || mp.smart_note_original_link || '',
    };

    try {
      const response = await sendWebhook(payload);
      const preview = typeof response === 'string'
        ? response.slice(0, 2000)
        : JSON.stringify(response).slice(0, 2000);

      await prisma.eppMeetStatus.update({
        where: { conference_id: conferenceId },
        data: {
          status: 'webhook_enviado',
          data_webhook_enviado: new Date(),
          webhook_last_status_code: 200,
          webhook_last_response: preview,
          webhook_last_error: null,
          updated_at: new Date(),
        },
      });

      logger.info(`[dispatch-webhook] ${conferenceId} enviado em ${Date.now() - startTime}ms`);
      return res.status(200).json({ ok: true, conference_id: conferenceId });
    } catch (err) {
      const statusCode = err.response?.status || null;
      logger.error(`[dispatch-webhook] falha ao enviar ${conferenceId}: ${err.message}`);
      await prisma.eppMeetStatus.update({
        where: { conference_id: conferenceId },
        data: {
          status: 'webhook_erro',
          webhook_last_status_code: statusCode,
          webhook_last_error: err.message?.slice(0, 2000),
          data_ultimo_erro: new Date(),
          updated_at: new Date(),
        },
      }).catch(() => {});
      return res.status(200).json({ ok: false, conference_id: conferenceId, error: err.message });
    }
  } catch (error) {
    logger.error('[dispatch-webhook] ERRO FATAL', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: error.message });
  }
}
