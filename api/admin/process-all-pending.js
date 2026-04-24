import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

const BATCH_SIZE = 30;

/**
 * POST /api/admin/process-all-pending
 *
 * Dispara processamento paralelo (fan-out) de TODAS as meets com
 * epp_meet_process.status NOT IN ('complete', 'error'). Cada meet roda
 * em sua própria função serverless via fetch para /api/cron/process-events.
 *
 * Útil quando a fila do cron acumulou e queremos zerar rápido sem
 * esperar 10+ ticks. Roda em batches sequenciais (cada batch paralelo)
 * para não explodir limites de conexão Prisma nem quota Google.
 *
 * Protegido por JWT admin — mesmo token que o user usa no app.
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
    // Aceita CRON_SECRET (para rodar via .http/curl) OU JWT admin (via app logado).
    const isCronSecret = process.env.CRON_SECRET && token === process.env.CRON_SECRET;
    if (!isCronSecret) {
      try {
        jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
      } catch {
        return res.status(401).json({ error: 'Token inválido' });
      }
    }

    const appUrl = process.env.APP_URL;
    if (!appUrl) return res.status(500).json({ error: 'APP_URL não configurado' });
    const cronSecret = process.env.CRON_SECRET || '';
    const target = `${appUrl}/api/cron/process-events`;

    // Meets mais NOVAS primeiro — foco no que o user vê nos filtros "Hoje"/"48h".
    const pending = await prisma.eppMeetProcess.findMany({
      where: { status: { notIn: ['complete', 'error'] } },
      select: { conference_id: true },
      orderBy: { last_event_at: 'desc' },
    });

    if (pending.length === 0) {
      return res.status(200).json({ total: 0, ok: 0, erro: 0, message: 'Nenhuma meet pending.' });
    }

    const results = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map((p) =>
          fetch(target, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cronSecret}`,
            },
            body: JSON.stringify({ conference_id: p.conference_id }),
          }).then(async (r) => ({
            conference_id: p.conference_id,
            ok: r.ok,
            status: r.status,
            body: r.ok ? null : (await r.text()).slice(0, 300),
          }))
        )
      );
      results.push(...batchResults.map((r, idx) =>
        r.status === 'fulfilled'
          ? r.value
          : { conference_id: batch[idx].conference_id, ok: false, error: r.reason?.message || 'unknown' }
      ));
    }

    return res.status(200).json({
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      erro: results.filter((r) => !r.ok).length,
      sample_errors: results.filter((r) => !r.ok).slice(0, 5),
    });
  } catch (err) {
    console.error('[process-all-pending] ERRO:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
