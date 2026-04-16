import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');
const config = require('../lib/config');
const {
  resolveUserIdByEmail,
  listUserSubscriptions,
  deleteSubscription,
  createUserSubscription,
} = require('../lib/workspaceEvents');

/**
 * POST /api/subscriptions/reconnect  body: { email }
 * Apaga todas as subscriptions atuais do usuário e cria uma nova.
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
    return res.status(400).json({ error: 'email não está em MONITORED_USERS' });
  }

  const topic = config.pubsub.fullTopicPath;
  if (!topic) return res.status(500).json({ error: 'topic path ausente' });

  try {
    const userId = await resolveUserIdByEmail(email);
    if (!userId) return res.status(404).json({ error: 'Usuário não encontrado' });

    // 1. Deletar subscriptions existentes
    const existing = await listUserSubscriptions(email, userId, topic);
    const deletedNames = [];
    const deleteErrors = [];
    for (const sub of existing) {
      try {
        await deleteSubscription(sub.name, email);
        deletedNames.push(sub.name);
      } catch (e) {
        deleteErrors.push({ name: sub.name, message: e.message });
      }
    }

    // 2. Criar subscription nova
    const created = await createUserSubscription(email, userId, topic);

    return res.status(200).json({
      success: true,
      email,
      deleted_count: deletedNames.length,
      deleted: deletedNames,
      delete_errors: deleteErrors,
      created_subscription: created,
    });
  } catch (err) {
    logger.error('[subscriptions/reconnect] erro', { email, error: err.message, data: err.data });
    return res.status(err.status || 500).json({
      error: 'Falha ao reconectar',
      message: err.message,
      details: err.data,
    });
  }
}
