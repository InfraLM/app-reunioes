import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const prisma = require('../../lib/prisma.cjs');

/**
 * GET /api/admin/diagnose?cid=conferenceRecords/xxx
 * Diagnóstico completo de uma conference: eventos, meet_process, meet_status.
 */
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cid = req.query.cid;

  // Se não passou cid, listar os 5 primeiros conference_ids do meet_process
  if (!cid) {
    const meets = await prisma.eppMeetProcess.findMany({
      take: 10,
      orderBy: { last_event_at: 'desc' },
      select: { conference_id: true, has_recording: true, has_transcript: true, has_smart_note: true, user_email: true },
    });
    return res.status(200).json({ hint: 'pass ?cid=conferenceRecords/xxx', meets });
  }

  const [events, mp, ms] = await Promise.all([
    prisma.eppEventoTrack.findMany({
      where: { conference_id: cid },
      orderBy: { received_at: 'asc' },
    }),
    prisma.eppMeetProcess.findUnique({ where: { conference_id: cid } }),
    prisma.eppMeetStatus.findUnique({ where: { conference_id: cid } }),
  ]);

  const evtSummary = events.map((e) => ({
    id: e.id?.toString(),
    event_type: e.event_type,
    is_monitored: e.is_monitored,
    resource_name: e.resource_name,
    link: e.link,
    user_email: e.user_email,
    raw_payload_keys: e.raw_payload ? Object.keys(e.raw_payload) : null,
    raw_smartNote_name: e.raw_payload?.smartNote?.name || null,
    raw_recording_name: e.raw_payload?.recording?.name || null,
    raw_transcript_name: e.raw_payload?.transcript?.name || null,
    received_at: e.received_at,
  }));

  return res.status(200).json({
    conference_id: cid,
    total_events: events.length,
    events: evtSummary,
    meet_process: mp ? {
      meeting_title: mp.meeting_title,
      meeting_start_time: mp.meeting_start_time,
      status: mp.status,
      user_email: mp.user_email,
      has_recording: mp.has_recording,
      has_transcript: mp.has_transcript,
      has_smart_note: mp.has_smart_note,
      recording_resource_name: mp.recording_resource_name,
      transcript_resource_name: mp.transcript_resource_name,
      smart_note_resource_name: mp.smart_note_resource_name,
      recording_original_link: mp.recording_original_link,
      transcript_original_link: mp.transcript_original_link,
      smart_note_original_link: mp.smart_note_original_link,
      recording_drive_link: mp.recording_drive_link,
      transcript_drive_link: mp.transcript_drive_link,
      smart_note_drive_link: mp.smart_note_drive_link,
      drive_folder_link: mp.drive_folder_link,
    } : null,
    meet_status: ms ? {
      status: ms.status,
      has_recording: ms.has_recording,
      has_transcript: ms.has_transcript,
      has_smart_note: ms.has_smart_note,
      ata_step: ms.ata_step,
      ata_progress: ms.ata_progress,
      ata_error_step: ms.ata_error_step,
      ata_step_started_at: ms.ata_step_started_at,
      processing_attempt_count: ms.processing_attempt_count,
      processing_last_status_code: ms.processing_last_status_code,
      processing_last_error: ms.processing_last_error,
      data_enfileirado: ms.data_enfileirado,
      data_processado: ms.data_processado,
      data_ultimo_erro: ms.data_ultimo_erro,
      data_ata_gerada: ms.data_ata_gerada,
      queued_by: ms.queued_by,
      updated_at: ms.updated_at,
    } : null,
  });
}
