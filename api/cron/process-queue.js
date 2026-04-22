import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const prisma = require('../../lib/prisma.cjs');

const MAX_PARALLEL = 5; // limite de atas disparadas por tick
const STUCK_MINUTES = 10; // timeout para considerar uma ata "presa" em processando
const AUTO_ATA_DELAY_MIN = 120; // minutos após data_primeiro_artefato para auto-enfileirar
const AUTO_ATA_BATCH = 10; // quantas reuniões auto-marcar por tick no máximo

/**
 * GET /api/cron/process-queue
 *
 * Vercel Cron (a cada minuto) que dispara /api/cron/generate-ata
 * em paralelo para todas as meetings com status = 'enfileirado'
 * (até MAX_PARALLEL por tick).
 *
 * Também reenfileira meetings que ficaram 'processando' por mais de 10 min
 * (dispatch original morreu).
 *
 * Protegido por CRON_SECRET (Vercel Cron injeta via header).
 */
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const isVercelCron = !!req.headers['x-vercel-cron']; // Vercel cron envia esse header
  if (
    process.env.CRON_SECRET
    && !isVercelCron
    && authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const stuckThreshold = new Date(now.getTime() - STUCK_MINUTES * 60 * 1000);

    // 0. Modo AUTO: se setting auto_ata='true', marca como 'enfileirado' toda reunião
    //    em 'artefatos_completos' cujo primeiro artefato chegou há > AUTO_ATA_DELAY_MIN.
    //    O próprio cron cai no bloco seguinte e dispara generate-ata normalmente.
    try {
      const autoSetting = await prisma.eppAppSettings.findUnique({ where: { key: 'auto_ata' } });
      if (autoSetting?.value === 'true') {
        const autoThreshold = new Date(now.getTime() - AUTO_ATA_DELAY_MIN * 60 * 1000);
        const candidates = await prisma.eppMeetStatus.findMany({
          where: {
            status: 'artefatos_completos',
            data_primeiro_artefato: { lte: autoThreshold },
          },
          select: { conference_id: true },
          take: AUTO_ATA_BATCH,
        });
        if (candidates.length > 0) {
          const ids = candidates.map((c) => c.conference_id);
          const { count } = await prisma.eppMeetStatus.updateMany({
            where: { conference_id: { in: ids }, status: 'artefatos_completos' },
            data: {
              status: 'enfileirado',
              data_enfileirado: now,
              queued_by: 'auto',
              processing_attempt_count: { increment: 1 },
              processing_last_error: null,
              ata_step: null,
              ata_progress: 0,
              ata_error_step: null,
              updated_at: now,
            },
          });
          console.log(`[process-queue] auto-ata: ${count} reunião(ões) enfileirada(s) (${ids.map((i) => i.slice(-12)).join(',')})`);
        }
      }
    } catch (autoErr) {
      // Não bloqueia o cron se auto-ata falhar — próximo tick tenta de novo
      console.error(`[process-queue] auto-ata falhou: ${autoErr.message}`);
    }

    // 1. Pega enfileirados (novos)
    const enqueued = await prisma.eppMeetStatus.findMany({
      where: { status: 'enfileirado' },
      orderBy: { data_enfileirado: 'asc' },
      take: MAX_PARALLEL,
      select: { conference_id: true, user_email: true },
    });

    // 2. Pega processando que está travado há mais de STUCK_MINUTES min
    const stuck = await prisma.eppMeetStatus.findMany({
      where: {
        status: 'processando',
        ata_step_started_at: { lt: stuckThreshold },
      },
      orderBy: { ata_step_started_at: 'asc' },
      take: Math.max(0, MAX_PARALLEL - enqueued.length),
      select: { conference_id: true, user_email: true, ata_step: true },
    });

    const pending = [...enqueued, ...stuck];
    if (pending.length === 0) {
      return res.status(200).json({ processed: 0, message: 'fila vazia' });
    }

    console.log(`[process-queue] disparando ${pending.length} meetings (${enqueued.length} novas + ${stuck.length} presas)`);

    const appUrl = process.env.APP_URL;
    const cronSecret = process.env.CRON_SECRET || '';
    if (!appUrl) {
      return res.status(500).json({ error: 'APP_URL não configurado' });
    }

    const targetUrl = `${appUrl}/api/cron/generate-ata`;

    // Dispara TUDO em paralelo. Cada chamada roda em sua própria função Vercel.
    // Usamos Promise.allSettled para não quebrar se uma falhar.
    const results = await Promise.allSettled(
      pending.map((p) =>
        fetch(targetUrl, {
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
          body: r.ok ? null : (await r.text()).slice(0, 500),
        }))
      )
    );

    const summary = results.map((r, i) => ({
      conference_id: pending[i].conference_id,
      ...(r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'unknown' }),
    }));

    console.log('[process-queue] concluído:', JSON.stringify({
      total: summary.length,
      ok: summary.filter((s) => s.ok).length,
      error: summary.filter((s) => !s.ok).length,
    }));

    return res.status(200).json({
      processed: summary.length,
      enqueued_count: enqueued.length,
      stuck_count: stuck.length,
      results: summary,
    });
  } catch (err) {
    console.error('[process-queue] ERRO:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
