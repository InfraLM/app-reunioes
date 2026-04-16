import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');
const config = require('../lib/config');
const {
  resolveUserIdByEmail,
  listUserSubscriptions,
} = require('../lib/workspaceEvents');

/**
 * GET /api/subscriptions/status
 *
 * Retorna o status de inscrição no tópico Pub/Sub para cada usuário em MONITORED_USERS.
 * Requer JWT no header Authorization.
 */
export default async function handler(req, res) {
  // CORS
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

  // Auth
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const topic = config.pubsub.fullTopicPath;
  if (!topic) {
    return res.status(500).json({
      error: 'Configuração ausente',
      message: 'GOOGLE_PROJECT_ID ou PUBSUB_TOPIC_NAME não definidos',
    });
  }

  const emails = config.usersToMonitor;
  logger.info('[subscriptions/status] consultando', { count: emails.length, topic });

  const results = await Promise.allSettled(
    emails.map(async (email) => {
      const userId = await resolveUserIdByEmail(email);
      if (!userId) {
        return {
          email,
          user_id: null,
          status: 'error',
          subscription_count: 0,
          subscription_names: [],
          error_message: 'Não foi possível resolver o ID do usuário (verifique se o email existe no Workspace)',
          last_updated: new Date().toISOString(),
        };
      }
      try {
        const subs = await listUserSubscriptions(email, userId, topic);
        return {
          email,
          user_id: userId,
          status: subs.length > 0 ? 'connected' : 'disconnected',
          subscription_count: subs.length,
          subscription_names: subs.map((s) => s.name),
          last_updated: new Date().toISOString(),
        };
      } catch (err) {
        logger.warn('[subscriptions/status] erro por usuário', { email, error: err.message });
        return {
          email,
          user_id: userId,
          status: 'error',
          subscription_count: 0,
          subscription_names: [],
          error_message: err.message,
          last_updated: new Date().toISOString(),
        };
      }
    })
  );

  const users = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : {
      email: emails[i],
      status: 'error',
      subscription_count: 0,
      subscription_names: [],
      error_message: r.reason?.message || 'unknown',
      last_updated: new Date().toISOString(),
    }
  );

  return res.status(200).json({
    topic,
    total: users.length,
    summary: {
      connected: users.filter((u) => u.status === 'connected').length,
      disconnected: users.filter((u) => u.status === 'disconnected').length,
      error: users.filter((u) => u.status === 'error').length,
    },
    users,
  });
}
