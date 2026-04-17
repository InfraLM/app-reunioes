import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');

const GAP_SECONDS = 60;

/**
 * POST /api/meetings/queue-webhook  body: { conference_ids: string[] }
 *
 * Enfileira N webhooks no QStash com delays escalonados (0s, 60s, 120s, ...)
 * e atualiza epp_meet_status com status='webhook_enfileirado'.
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let authedEmail = null;
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
    authedEmail = decoded?.login || decoded?.email || 'unknown';
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const { conference_ids } = req.body || {};
  if (!Array.isArray(conference_ids) || conference_ids.length === 0) {
    return res.status(400).json({ error: 'conference_ids (array) é obrigatório' });
  }

  const qstashToken = process.env.QSTASH_TOKEN;
  const appUrl = process.env.APP_URL;
  const cronSecret = process.env.CRON_SECRET || '';
  if (!qstashToken || !appUrl) {
    return res.status(500).json({ error: 'QSTASH_TOKEN ou APP_URL não configurados' });
  }

  const targetUrl = `${appUrl}/api/cron/generate-ata`;
  const results = [];

  for (let i = 0; i < conference_ids.length; i++) {
    const cid = conference_ids[i];
    const delaySeconds = i * GAP_SECONDS;
    const scheduledFor = new Date(Date.now() + delaySeconds * 1000);

    try {
      // Publica no QStash
      const qstashRes = await fetch(
        'https://qstash.upstash.io/v2/publish/' + encodeURIComponent(targetUrl),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${qstashToken}`,
            'Content-Type': 'application/json',
            'Upstash-Delay': `${delaySeconds}s`,
            'Upstash-Forward-Authorization': `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({ conference_id: cid }),
        }
      );
      const qstashBody = await qstashRes.json().catch(() => null);
      if (!qstashRes.ok) {
        throw new Error(`QStash falhou: ${qstashRes.status} ${JSON.stringify(qstashBody)}`);
      }
      const qstashMsgId = qstashBody?.messageId || qstashBody?.messageIds?.[0] || null;

      // UPSERT em meet_status
      await prisma.eppMeetStatus.upsert({
        where: { conference_id: cid },
        update: {
          status: 'webhook_enfileirado',
          webhook_scheduled_for: scheduledFor,
          webhook_qstash_msg_id: qstashMsgId,
          webhook_attempt_count: { increment: 1 },
          data_webhook_enfileirado: new Date(),
          queued_by: authedEmail,
          updated_at: new Date(),
        },
        create: {
          conference_id: cid,
          user_email: 'unknown',
          status: 'webhook_enfileirado',
          webhook_scheduled_for: scheduledFor,
          webhook_qstash_msg_id: qstashMsgId,
          webhook_attempt_count: 1,
          data_webhook_enfileirado: new Date(),
          queued_by: authedEmail,
        },
      });

      results.push({
        conference_id: cid,
        status: 'ok',
        scheduled_for: scheduledFor.toISOString(),
        delay_seconds: delaySeconds,
        qstash_msg_id: qstashMsgId,
      });
    } catch (err) {
      console.error(`[queue-webhook] falha ao enfileirar ${cid}: ${err.message}`);
      results.push({ conference_id: cid, status: 'error', message: err.message });
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    error: results.filter((r) => r.status === 'error').length,
    gap_seconds: GAP_SECONDS,
  };

  console.log('[queue-webhook] concluído:', JSON.stringify(summary));

  // Escolhe status HTTP apropriado para o frontend detectar erro:
  // - 200 OK: tudo certo
  // - 207 Multi-Status: parcial (alguns ok, alguns erro)
  // - 502 Bad Gateway: todas falharam (problema no QStash/infra)
  let httpStatus = 200;
  if (summary.ok === 0 && summary.error > 0) httpStatus = 502;
  else if (summary.error > 0) httpStatus = 207;

  return res.status(httpStatus).json({ summary, results });
}
