import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');
const config = require('../lib/config');
const {
  resolveUserIdByEmail,
  createUserSubscription,
} = require('../lib/workspaceEvents');

/**
 * POST /api/subscriptions/connect  body: { email }
 * Cria subscription para o usuário no tópico Pub/Sub.
 */
export default async function handler(req, res) {
  const origin = req.headers.origin;
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];
  const allowed = corsOrigins.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin));
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email é obrigatório' });

  if (!config.usersToMonitor.includes(email)) {
    return res.status(400).json({
      error: 'email não está em MONITORED_USERS',
      hint: 'Só é possível conectar usuários da lista monitorada.',
    });
  }

  const topic = config.pubsub.fullTopicPath;
  if (!topic) return res.status(500).json({ error: 'PUBSUB_TOPIC_NAME/GOOGLE_PROJECT_ID ausente' });

  try {
    const userId = await resolveUserIdByEmail(email);
    if (!userId) return res.status(404).json({ error: 'Usuário não encontrado no Workspace' });

    const subscription = await createUserSubscription(email, userId, topic);
    return res.status(200).json({
      success: true,
      email,
      user_id: userId,
      subscription,
    });
  } catch (err) {
    logger.error('[subscriptions/connect] erro', { email, error: err.message, data: err.data });
    return res.status(err.status || 500).json({
      error: 'Falha ao criar subscription',
      message: err.message,
      details: err.data,
    });
  }
}
