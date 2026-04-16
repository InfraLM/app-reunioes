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

// Delay entre usuários — a API limita reads/minuto, então processamos sequencial.
const DELAY_BETWEEN_USERS_MS = 1200;
// Retry em caso de quota (HTTP 429 / RESOURCE_EXHAUSTED)
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 15000; // espera 15s se tomar quota

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/subscriptions/reconnect-all
 *
 * Reconecta todos os usuários monitorados SEQUENCIALMENTE (com delay)
 * para não exceder a quota "All read requests per minute" da Workspace Events API.
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

  const topic = config.pubsub.fullTopicPath;
  if (!topic) return res.status(500).json({ error: 'topic path ausente' });

  const emails = config.usersToMonitor;
  // Permite reconectar só um subconjunto (útil para retry dos que falharam)
  const onlyEmails = Array.isArray(req.body?.only_emails) ? req.body.only_emails : null;
  const targets = onlyEmails ? emails.filter((e) => onlyEmails.includes(e)) : emails;

  logger.info('[subscriptions/reconnect-all] iniciando (sequencial)', {
    count: targets.length,
    delayMs: DELAY_BETWEEN_USERS_MS,
  });

  const details = [];

  for (const email of targets) {
    let attempt = 0;
    let lastError = null;
    let success = false;

    while (attempt <= MAX_RETRIES && !success) {
      try {
        const userId = await resolveUserIdByEmail(email);
        if (!userId) {
          details.push({ email, status: 'error', message: 'ID não encontrado no Workspace' });
          break;
        }

        // 1. Lista subscriptions existentes
        const existing = await listUserSubscriptions(email, userId, topic);
        const deletedNames = [];
        for (const sub of existing) {
          try {
            await deleteSubscription(sub.name, email);
            deletedNames.push(sub.name);
            // pequeno delay entre delete e create para não estourar quota
            await sleep(300);
          } catch (delErr) {
            logger.warn('[reconnect-all] falha ao deletar sub existente', {
              email,
              name: sub.name,
              error: delErr.message,
            });
          }
        }

        // 2. Cria subscription nova
        const created = await createUserSubscription(email, userId, topic);

        details.push({
          email,
          status: 'ok',
          deleted_count: deletedNames.length,
          created_subscription_name: created?.name,
          retries: attempt,
        });
        success = true;
      } catch (err) {
        lastError = err;
        const isQuota =
          err.status === 429 ||
          /Quota exceeded|RESOURCE_EXHAUSTED/i.test(err.message || '');

        if (isQuota && attempt < MAX_RETRIES) {
          logger.warn('[reconnect-all] quota exceeded, aguardando retry', {
            email,
            attempt: attempt + 1,
            waitMs: RETRY_BACKOFF_MS,
          });
          await sleep(RETRY_BACKOFF_MS);
          attempt++;
          continue;
        }

        logger.warn('[reconnect-all] erro por usuário', { email, error: err.message });
        details.push({ email, status: 'error', message: err.message, retries: attempt });
        break;
      }
    }

    // delay entre usuários (mesmo em sucesso)
    await sleep(DELAY_BETWEEN_USERS_MS);
  }

  const summary = {
    total: details.length,
    ok: details.filter((d) => d.status === 'ok').length,
    error: details.filter((d) => d.status === 'error').length,
  };

  logger.info('[subscriptions/reconnect-all] concluído', summary);
  return res.status(200).json({ summary, details });
}
