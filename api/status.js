import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const prisma = require('../lib/prisma.cjs');

/**
 * GET /api/status
 * Status do monitoramento em tempo real (lê de epp_meet_process).
 */
export default async function handler(req, res) {
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];

  const origin = req.headers.origin;
  const isAllowed = corsOrigins.some(allowed =>
    allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
  );

  if (isAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const activeMeets = await prisma.eppMeetProcess.findMany({
      where: { status: { in: ['pending', 'processing'] } },
      orderBy: { first_event_at: 'desc' },
    });

    const [pending, processing, complete, partial, error, totalEvents] = await Promise.all([
      prisma.eppMeetProcess.count({ where: { status: 'pending' } }),
      prisma.eppMeetProcess.count({ where: { status: 'processing' } }),
      prisma.eppMeetProcess.count({ where: { status: 'complete' } }),
      prisma.eppMeetProcess.count({ where: { status: 'partial' } }),
      prisma.eppMeetProcess.count({ where: { status: 'error' } }),
      prisma.eppEventoTrack.count(),
    ]);

    const conferences = activeMeets.map((m) => ({
      id: m.conference_id,
      startTime: m.first_event_at ? new Date(m.first_event_at).getTime() : Date.now(),
      timeoutTime: null,
      artifacts: {
        recording: m.has_recording,
        transcript: m.has_transcript,
        smartNote: m.has_smart_note,
      },
      copied: {
        recording: !!m.recording_copied_at,
        transcript: !!m.transcript_copied_at,
        smartNote: !!m.smart_note_copied_at,
      },
      driveFolder: m.drive_folder_link,
      status: m.status,
      userEmail: m.user_email || 'Desconhecido',
      progress: m.status === 'pending'
        ? 'Aguardando mais artefatos ou processamento...'
        : 'Processando (cópia / webhook)...',
      logs: [],
    }));

    return res.status(200).json({
      conferences,
      subscriptions: { total: 0, successful: 0, failed: 0 },
      connected: true,
      mode: 'serverless-events-log',
      monitoring: {
        pending,
        processing,
        complete,
        partial,
        error,
        total_events: totalEvents,
        active: pending + processing,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao buscar status:', error);
    return res.status(500).json({ error: 'Erro ao buscar status', message: error.message });
  }
}
