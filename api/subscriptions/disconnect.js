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
} = require('../lib/workspaceEvents');

/**
 * POST /api/subscriptions/disconnect  body: { email }
 * Remove todas as subscriptions do usuário apontando para o nosso topic.
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

  const topic = config.pubsub.fullTopicPath;
  if (!topic) return res.status(500).json({ error: 'topic path ausente' });

  try {
    const userId = await resolveUserIdByEmail(email);
    if (!userId) return res.status(404).json({ error: 'Usuário não encontrado' });

    const subs = await listUserSubscriptions(email, userId, topic);
    const deleted = [];
    const errors = [];
    for (const sub of subs) {
      try {
        await deleteSubscription(sub.name, email);
        deleted.push(sub.name);
      } catch (e) {
        errors.push({ name: sub.name, message: e.message });
      }
    }

    return res.status(200).json({
      success: errors.length === 0,
      email,
      deleted_count: deleted.length,
      deleted,
      errors,
    });
  } catch (err) {
    logger.error('[subscriptions/disconnect] erro', { email, error: err.message });
    return res.status(err.status || 500).json({ error: 'Falha ao desconectar', message: err.message });
  }
}
