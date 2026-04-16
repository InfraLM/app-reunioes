import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

const TRACKING_WINDOW_MINUTES = 180;

/**
 * GET /api/meetings/recent
 *
 * Retorna reuniões com eventos nos últimos 180 min, agrupadas por conference_id.
 * Cada reunião traz 5 checkboxes (started, ended, recording, transcript, smart_note)
 * e os links do Drive interno (não os originais).
 *
 * Protegido por JWT.
 */
export default async function handler(req, res) {
  const origin = req.headers.origin;
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];
  const allowed = corsOrigins.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin));
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const cutoff = new Date(Date.now() - TRACKING_WINDOW_MINUTES * 60 * 1000);

  // Agrupar eventos por conference_id nos últimos 180 min
  const rows = await prisma.$queryRaw`
    SELECT
      e.conference_id,
      bool_or(e.event_type = 'started')    AS has_started,
      bool_or(e.event_type = 'ended')      AS has_ended,
      bool_or(e.event_type = 'recording')  AS has_recording,
      bool_or(e.event_type = 'transcript') AS has_transcript,
      bool_or(e.event_type = 'smart_note') AS has_smart_note,
      MIN(e.received_at)                   AS first_event_at,
      MAX(e.received_at)                   AS last_event_at,
      MAX(e.user_email)                    AS user_email
    FROM lovable.epp_evento_track e
    WHERE e.received_at >= ${cutoff}
      AND e.is_monitored = true
      AND e.conference_id IS NOT NULL
    GROUP BY e.conference_id
    ORDER BY MIN(e.received_at) DESC
    LIMIT 100
  `;

  const conferenceIds = rows.map((r) => r.conference_id);

  // Buscar dados do Drive interno
  const processes = conferenceIds.length > 0
    ? await prisma.eppMeetProcess.findMany({
        where: { conference_id: { in: conferenceIds } },
        select: {
          conference_id: true,
          meeting_title: true,
          meeting_start_time: true,
          meeting_end_time: true,
          drive_folder_link: true,
          recording_drive_link: true,
          transcript_drive_link: true,
          smart_note_drive_link: true,
        },
      })
    : [];
  const mpMap = new Map(processes.map((p) => [p.conference_id, p]));

  // Buscar status em meet_status (se existir)
  const statuses = conferenceIds.length > 0
    ? await prisma.eppMeetStatus.findMany({
        where: { conference_id: { in: conferenceIds } },
        select: { conference_id: true, status: true },
      })
    : [];
  const statusMap = new Map(statuses.map((s) => [s.conference_id, s.status]));

  const meetings = rows.map((r) => {
    const mp = mpMap.get(r.conference_id) || {};
    const expiresAt = new Date(new Date(r.first_event_at).getTime() + TRACKING_WINDOW_MINUTES * 60 * 1000);
    return {
      conference_id: r.conference_id,
      user_email: r.user_email,
      meeting_title: mp.meeting_title || null,
      meeting_start_time: mp.meeting_start_time || null,
      first_event_at: r.first_event_at,
      last_event_at: r.last_event_at,
      expires_at: expiresAt,
      minutes_remaining: Math.max(0, Math.round((expiresAt - Date.now()) / 60000)),

      // 5 checkboxes
      has_started: r.has_started,
      has_ended: r.has_ended,
      has_recording: r.has_recording,
      has_transcript: r.has_transcript,
      has_smart_note: r.has_smart_note,

      // Links do Drive interno (não originais)
      drive_folder_link: mp.drive_folder_link || null,
      recording_link: mp.recording_drive_link || null,
      transcript_link: mp.transcript_drive_link || null,
      smart_note_link: mp.smart_note_drive_link || null,

      // Status no ciclo de vida (se tiver)
      lifecycle_status: statusMap.get(r.conference_id) || null,
    };
  });

  return res.status(200).json({
    tracking_window_minutes: TRACKING_WINDOW_MINUTES,
    total: meetings.length,
    meetings,
  });
}
