import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const prisma = require('../lib/prisma.cjs');

/**
 * GET /api/status
 * Retorna status do monitoramento de reuniões em tempo real
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Buscar conferências ativas (waiting, processing)
    const activeConferences = await prisma.conferenceArtifactTracking.findMany({
      where: {
        status: { in: ['waiting', 'processing'] }
      },
      orderBy: {
        first_event_at: 'desc'
      }
    });

    // Buscar contadores
    const [waiting, processing, total] = await Promise.all([
      prisma.conferenceArtifactTracking.count({ where: { status: 'waiting' } }),
      prisma.conferenceArtifactTracking.count({ where: { status: 'processing' } }),
      prisma.conferenceArtifactTracking.count()
    ]);

    // Transformar para o formato esperado pelo frontend (ConferenceStatus)
    const conferences = activeConferences.map(conf => ({
      id: conf.conference_id,
      startTime: conf.first_event_at ? new Date(conf.first_event_at).getTime() : Date.now(),
      timeoutTime: new Date(conf.timeout_at).getTime(),
      artifacts: {
        recording: conf.has_recording,
        transcript: conf.has_transcript,
        smartNote: conf.has_smart_note
      },
      status: conf.status,
      userEmail: conf.user_email || 'Desconhecido',
      progress: conf.status === 'waiting'
        ? 'Aguardando artefatos...'
        : 'Processando webhook...',
      logs: [] // Logs podem ser implementados depois
    }));

    // Resposta no formato esperado pelo frontend
    const status = {
      conferences, // Array de conferências ativas
      subscriptions: {
        total: 0, // Push mode não usa subscriptions ativas
        successful: 0,
        failed: 0
      },
      connected: true,
      mode: 'serverless-push',
      monitoring: {
        waiting,
        processing,
        total,
        active: waiting + processing
      },
      timestamp: new Date().toISOString()
    };

    return res.status(200).json(status);
  } catch (error) {
    console.error('Erro ao buscar status:', error);
    return res.status(500).json({
      error: 'Erro ao buscar status',
      message: error.message
    });
  }
}
