import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * GET /api/ata/progress
 *
 * Retorna a fila de geração de atas:
 *  - processing: em processamento ativo (enfileirado, processando, erro recentes)
 *  - processed: atas geradas com sucesso (últimos 30 dias)
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
    } catch {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Em processamento: enfileirado, processando, ou erro (dá chance de reprocessar)
    const processing = await prisma.eppMeetStatus.findMany({
      where: {
        status: { in: ['enfileirado', 'processando', 'erro'] },
      },
      orderBy: [{ data_enfileirado: 'asc' }],
      select: {
        conference_id: true,
        status: true,
        user_email: true,
        meeting_title: true,
        meeting_start_time: true,
        meeting_end_time: true,
        ata_step: true,
        ata_progress: true,
        ata_step_started_at: true,
        ata_error_step: true,
        processing_attempt_count: true,
        processing_last_error: true,
        data_enfileirado: true,
        data_ultimo_erro: true,
        queued_by: true,
        updated_at: true,
      },
    });

    // Processado: ata gerada nos últimos 30 dias
    const processed = await prisma.eppMeetStatus.findMany({
      where: {
        status: 'ata_gerada',
        data_ata_gerada: { gte: thirtyDaysAgo },
      },
      orderBy: { data_ata_gerada: 'desc' },
      take: 100,
      select: {
        conference_id: true,
        status: true,
        user_email: true,
        meeting_title: true,
        meeting_start_time: true,
        meeting_end_time: true,
        data_ata_gerada: true,
        processing_last_response: true,
        queued_by: true,
      },
    });

    // Enriquecer "processed" com o link do PDF da governanca
    const cids = processed.map((p) => p.conference_id);
    const governancas = cids.length > 0
      ? await prisma.eppReunioesGovernanca.findMany({
          where: { conference_id: { in: cids } },
          select: {
            conference_id: true,
            titulo_reuniao: true,
            ata_pdf_link: true,
            ata_link_download: true,
          },
        })
      : [];
    const byCid = new Map(governancas.map((g) => [g.conference_id, g]));

    const processedEnriched = processed.map((p) => {
      const g = byCid.get(p.conference_id);
      return {
        ...p,
        // prefere título da governança (gerado pela IA) sobre o do meet_status
        meeting_title: g?.titulo_reuniao || p.meeting_title,
        ata_pdf_link: g?.ata_pdf_link || null,
        ata_link_download: g?.ata_link_download || null,
      };
    });

    return res.status(200).json({
      now: now.toISOString(),
      processing_count: processing.length,
      processed_count: processedEnriched.length,
      processing,
      processed: processedEnriched,
    });
  } catch (err) {
    console.error('[ata/progress] ERRO:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
