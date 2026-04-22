import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * POST /api/meetings/dequeue-ata  body: { conference_id }
 *
 * Tira uma reunião da fila de ata (botão "Excluir" em cards com erro).
 * Volta o status para o estado "pré-ata":
 *   - Se data_ata_gerada IS NOT NULL → 'ata_gerada' (ata antiga existia)
 *   - Senão se todos has_* = true → 'artefatos_completos'
 *   - Senão → 'artefatos_faltantes'
 *
 * Zera APENAS campos de processamento em andamento. Preserva histórico de
 * auditoria (data_enfileirado, data_processado, data_ata_gerada, attempt_count).
 * NÃO apaga epp_reunioes_governanca — mantém ata antiga se existia.
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
    const current = await prisma.eppMeetStatus.findUnique({
      where: { conference_id },
      select: {
        data_ata_gerada: true,
        has_recording: true,
        has_transcript: true,
        has_smart_note: true,
      },
    });
    if (!current) {
      return res.status(404).json({ error: 'Reunião não encontrada em meet_status' });
    }

    let newStatus;
    if (current.data_ata_gerada) {
      newStatus = 'ata_gerada';
    } else if (current.has_recording && current.has_transcript && current.has_smart_note) {
      newStatus = 'artefatos_completos';
    } else {
      newStatus = 'artefatos_faltantes';
    }

    await prisma.eppMeetStatus.update({
      where: { conference_id },
      data: {
        status: newStatus,
        ata_step: null,
        ata_progress: 0,
        ata_step_started_at: null,
        ata_error_step: null,
        processing_last_error: null,
        processing_last_status_code: null,
        processing_last_response: null,
        data_ultimo_erro: null,
        // Bloqueia re-enfileirar pelo modo AUTO. Só volta a ser elegível
        // se o usuário clicar "Criar ata" manualmente (enqueue-ata reseta).
        auto_ata_attempted: true,
        updated_at: new Date(),
      },
    });

    console.log(`[dequeue-ata] ${conference_id} → ${newStatus} (por ${authedEmail})`);

    return res.status(200).json({
      success: true,
      conference_id,
      new_status: newStatus,
      reason:
        newStatus === 'ata_gerada'
          ? 'já tinha ata gerada antes'
          : newStatus === 'artefatos_completos'
            ? 'todos artefatos presentes'
            : 'faltam artefatos',
    });
  } catch (err) {
    console.error(`[dequeue-ata] falha ${conference_id}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
