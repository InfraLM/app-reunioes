import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * POST /api/meetings/enqueue-ata  body: { conference_ids: string[] }
 *
 * Marca as meetings como `status = 'enfileirado'` em epp_meet_status.
 * Não dispara processamento — o cron /api/cron/process-queue (cada 1min)
 * pega e dispara /api/cron/generate-ata em paralelo.
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

  const results = [];

  for (const cid of conference_ids) {
    try {
      await prisma.eppMeetStatus.upsert({
        where: { conference_id: cid },
        update: {
          status: 'enfileirado',
          processing_attempt_count: { increment: 1 },
          processing_last_error: null,
          data_enfileirado: new Date(),
          queued_by: authedEmail,
          ata_step: null,
          ata_progress: 0,
          ata_error_step: null,
          // Clique manual reseta o bloqueio do modo AUTO — usuário está
          // assumindo explicitamente uma nova tentativa.
          auto_ata_attempted: false,
          updated_at: new Date(),
        },
        create: {
          conference_id: cid,
          user_email: 'unknown',
          status: 'enfileirado',
          processing_attempt_count: 1,
          data_enfileirado: new Date(),
          queued_by: authedEmail,
        },
      });
      results.push({ conference_id: cid, status: 'ok' });
    } catch (err) {
      console.error(`[enqueue-ata] falha ao enfileirar ${cid}: ${err.message}`);
      results.push({ conference_id: cid, status: 'error', message: err.message });
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    error: results.filter((r) => r.status === 'error').length,
  };

  console.log('[enqueue-ata] concluído:', JSON.stringify(summary));

  let httpStatus = 200;
  if (summary.ok === 0 && summary.error > 0) httpStatus = 502;
  else if (summary.error > 0) httpStatus = 207;

  return res.status(httpStatus).json({ summary, results });
}
