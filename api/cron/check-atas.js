import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');

/**
 * GET/POST /api/cron/check-atas
 *
 * Detecta meetings com status 'webhook_enviado' cuja ata foi preenchida
 * em epp_reunioes_governanca (campo 'ata' não-vazio) e move para 'ata_gerada'.
 *
 * Pode ser chamado por:
 *   - Vercel Cron (recomendado: */2 minutos)
 *   - QStash schedule
 *   - Botão manual no frontend (com CRON_SECRET)
 */
export default async function handler(req, res) {
  try {
    // Aceita tanto Vercel Cron (User-Agent vercel-cron) quanto CRON_SECRET
    const isVercelCron = (req.headers['user-agent'] || '').toLowerCase().includes('vercel-cron');
    if (!isVercelCron) {
      const authHeader = req.headers.authorization;
      if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    logger.info('[check-atas] iniciando varredura');

    const pending = await prisma.eppMeetStatus.findMany({
      where: {
        status: { in: ['webhook_enviado'] },
        data_ata_gerada: null,
      },
      select: { conference_id: true },
      take: 200,
    });

    if (!pending.length) {
      logger.info('[check-atas] nenhum pendente');
      return res.status(200).json({ checked: 0, updated: 0 });
    }

    const ids = pending.map((p) => p.conference_id);
    const governancas = await prisma.eppReunioesGovernanca.findMany({
      where: { conference_id: { in: ids } },
      select: { conference_id: true, ata: true },
    });

    const updated = [];
    for (const g of governancas) {
      if (g.ata && g.ata.trim().length > 0) {
        await prisma.eppMeetStatus.update({
          where: { conference_id: g.conference_id },
          data: {
            status: 'ata_gerada',
            data_ata_gerada: new Date(),
            updated_at: new Date(),
          },
        });
        updated.push(g.conference_id);
      }
    }

    logger.info(`[check-atas] concluído: ${updated.length} atualizadas de ${pending.length} candidatas`);
    return res.status(200).json({ checked: pending.length, updated: updated.length, ids: updated });
  } catch (error) {
    logger.error('[check-atas] ERRO', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: error.message });
  }
}
