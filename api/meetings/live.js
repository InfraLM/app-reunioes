import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * GET /api/meetings/live
 *
 * Retorna reuniões "ao vivo": têm evento 'started' mas NÃO 'ended'.
 * Limita a reuniões cujo primeiro evento foi nas últimas 24h.
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

  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Conferências com 'started' mas sem 'ended' (últimas 24h)
  const rows = await prisma.$queryRaw`
    SELECT
      s.conference_id,
      s.user_email,
      s.received_at AS started_at,
      (
        SELECT bool_or(e2.event_type = 'recording')
        FROM lovable.epp_evento_track e2
        WHERE e2.conference_id = s.conference_id AND e2.is_monitored = true
      ) AS has_recording,
      (
        SELECT bool_or(e2.event_type = 'transcript')
        FROM lovable.epp_evento_track e2
        WHERE e2.conference_id = s.conference_id AND e2.is_monitored = true
      ) AS has_transcript,
      (
        SELECT bool_or(e2.event_type = 'smart_note')
        FROM lovable.epp_evento_track e2
        WHERE e2.conference_id = s.conference_id AND e2.is_monitored = true
      ) AS has_smart_note
    FROM lovable.epp_evento_track s
    WHERE s.event_type = 'started'
      AND s.is_monitored = true
      AND s.conference_id IS NOT NULL
      AND s.received_at >= ${cutoff24h}
      AND NOT EXISTS (
        SELECT 1 FROM lovable.epp_evento_track e
        WHERE e.conference_id = s.conference_id
          AND e.event_type = 'ended'
          AND e.is_monitored = true
      )
    ORDER BY s.received_at DESC
    LIMIT 50
  `;

  const conferenceIds = rows.map((r) => r.conference_id);

  const processes = conferenceIds.length > 0
    ? await prisma.eppMeetProcess.findMany({
        where: { conference_id: { in: conferenceIds } },
        select: {
          conference_id: true,
          meeting_title: true,
          meeting_start_time: true,
          drive_folder_link: true,
        },
      })
    : [];
  const mpMap = new Map(processes.map((p) => [p.conference_id, p]));

  const meetings = rows.map((r) => {
    const mp = mpMap.get(r.conference_id) || {};
    const startedAt = new Date(r.started_at);
    const durationMin = Math.round((Date.now() - startedAt.getTime()) / 60000);
    return {
      conference_id: r.conference_id,
      user_email: r.user_email,
      meeting_title: mp.meeting_title || null,
      started_at: r.started_at,
      duration_minutes: durationMin,
      drive_folder_link: mp.drive_folder_link || null,
      has_recording: r.has_recording || false,
      has_transcript: r.has_transcript || false,
      has_smart_note: r.has_smart_note || false,
    };
  });

  return res.status(200).json({
    total: meetings.length,
    meetings,
  });
}
