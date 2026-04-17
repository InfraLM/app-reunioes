import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const prisma = require('../../lib/prisma.cjs');

/**
 * POST /api/admin/backfill-all
 *
 * Pega todos os conference_ids distintos em epp_evento_track e dispara
 * o worker process-events para cada um. Popula meet_process e meet_status
 * com dados retroativos.
 *
 * Protegido por CRON_SECRET.
 */
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[backfill] Iniciando backfill retroativo...');

    // Pega todos os conference_ids distintos de evento_track
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT conference_id
      FROM lovable.epp_evento_track
      WHERE conference_id IS NOT NULL
      ORDER BY conference_id
    `;

    console.log(`[backfill] ${rows.length} conferences distintas encontradas`);

    const appUrl = process.env.APP_URL;
    const cronSecret = process.env.CRON_SECRET;
    if (!appUrl) {
      return res.status(500).json({ error: 'APP_URL não configurado' });
    }

    const targetUrl = `${appUrl}/api/cron/process-events`;
    const results = [];

    // Processar cada conference sequencialmente (invocando o worker com conference_id específico)
    for (const row of rows) {
      const cid = row.conference_id;
      try {
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({ conference_id: cid }),
        });
        const body = await response.json().catch(() => ({}));
        results.push({
          conference_id: cid,
          ok: response.ok,
          status: body?.results?.[0]?.status || 'unknown',
        });
      } catch (err) {
        console.error(`[backfill] erro em ${cid}: ${err.message}`);
        results.push({ conference_id: cid, ok: false, error: err.message });
      }
    }

    const summary = {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      error: results.filter((r) => !r.ok).length,
    };

    console.log('[backfill] Concluído:', summary);
    return res.status(200).json({ success: true, summary, results });
  } catch (error) {
    console.error('[backfill] ERRO FATAL:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
