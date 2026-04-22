import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * POST /api/meetings/retry-ata  body: { conference_id }
 *
 * Retry completo de uma ata:
 *  1. Apaga linha em epp_reunioes_governanca (se existir) — evita dados
 *     parciais de tentativa anterior contaminando o UPSERT seguinte.
 *  2. Reseta todos os campos de processamento em epp_meet_status
 *     (ata_step, ata_progress, ata_error_step, processing_last_error,
 *     processing_last_status_code, processing_last_response,
 *     data_processado, data_ata_gerada, data_ultimo_erro).
 *  3. Marca status='enfileirado', incrementa processing_attempt_count,
 *     grava data_enfileirado e queued_by.
 *
 * Após isso, o cron /api/cron/process-queue pega e dispara
 * /api/cron/generate-ata normalmente.
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

  const { conference_id } = req.body || {};
  if (!conference_id || typeof conference_id !== 'string') {
    return res.status(400).json({ error: 'conference_id é obrigatório' });
  }

  try {
    // 1. Apaga governanca — garante que o UPSERT seguinte começa limpo
    await prisma.eppReunioesGovernanca
      .delete({ where: { conference_id } })
      .catch((e) => {
        if (e.code !== 'P2025') throw e; // P2025 = not found, OK
      });

    // 2 + 3. Reset completo de meet_status e marca enfileirado
    const updated = await prisma.eppMeetStatus.update({
      where: { conference_id },
      data: {
        status: 'enfileirado',
        ata_step: null,
        ata_progress: 0,
        ata_step_started_at: null,
        ata_error_step: null,
        processing_attempt_count: { increment: 1 },
        processing_last_status_code: null,
        processing_last_response: null,
        processing_last_error: null,
        data_enfileirado: new Date(),
        data_processado: null,
        data_ata_gerada: null,
        data_ultimo_erro: null,
        queued_by: authedEmail,
        updated_at: new Date(),
      },
    });

    console.log(`[retry-ata] ${conference_id} reenfileirado por ${authedEmail} (tentativa ${updated.processing_attempt_count})`);

    return res.status(200).json({
      success: true,
      conference_id,
      attempt: updated.processing_attempt_count,
    });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Reunião não encontrada em meet_status' });
    }
    console.error(`[retry-ata] falha ${conference_id}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
