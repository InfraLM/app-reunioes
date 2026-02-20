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
    // Buscar conferências sendo monitoradas
    const [waiting, processing, total] = await Promise.all([
      // Aguardando artefatos
      prisma.conferenceArtifactTracking.count({
        where: { status: 'waiting' }
      }),
      // Em processamento
      prisma.conferenceArtifactTracking.count({
        where: { status: 'processing' }
      }),
      // Total geral
      prisma.conferenceArtifactTracking.count()
    ]);

    // Status do sistema serverless
    const status = {
      connected: true, // Sempre conectado (serverless está ativo)
      mode: 'serverless-push', // Push-based Pub/Sub
      monitoring: {
        waiting,
        processing,
        total,
        active: waiting + processing // Total ativo
      },
      timestamp: new Date().toISOString(),
      webhook: {
        endpoint: process.env.WEBHOOK_DESTINATION_URL ? 'configured' : 'not configured',
        pubsub: 'push-based' // Push subscription
      }
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
