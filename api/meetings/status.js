import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * GET /api/meetings/status?filter=todos|em_aguardo|ata_gerada
 *
 * Lista meetings de epp_meet_status com LEFT JOIN em epp_reunioes_governanca
 * para obter ata/links finais quando já gerada.
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const filter = String(req.query.filter || 'todos');
  let where = {};
  if (filter === 'em_aguardo') {
    where = { status: { in: ['artefatos_faltantes', 'artefatos_completos', 'erro'] } };
  } else if (filter === 'ata_gerada') {
    where = { status: 'ata_gerada' };
  }

  const [statuses, processes, governancas] = await Promise.all([
    prisma.eppMeetStatus.findMany({
      where,
      orderBy: [{ meeting_start_time: 'desc' }, { updated_at: 'desc' }],
      take: 500,
    }),
    prisma.eppMeetProcess.findMany({
      select: {
        conference_id: true,
        drive_folder_link: true,
        meeting_start_time: true,
        meeting_end_time: true,
        recording_drive_link: true,
        transcript_drive_link: true,
        smart_note_drive_link: true,
        recording_original_link: true,
        transcript_original_link: true,
        smart_note_original_link: true,
      },
    }),
    prisma.eppReunioesGovernanca.findMany({
      select: {
        conference_id: true,
        data_reuniao: true,
        hora_inicio: true,
        hora_fim: true,
        responsavel: true,
        titulo_reuniao: true,
        ata: true,
        ata_link_download: true,
        ata_pdf_link: true,
        link_gravacao: true,
        link_transcricao: true,
        link_anotacao: true,
        participantes_nomes: true,
        resumo_executivo: true,
      },
    }),
  ]);

  const mpMap = new Map(processes.map((p) => [p.conference_id, p]));
  const govMap = new Map(governancas.map((g) => [g.conference_id, g]));

  const meetings = statuses.map((s) => {
    const mp = mpMap.get(s.conference_id) || {};
    const gov = govMap.get(s.conference_id) || null;
    return {
      ...s,
      // Fallback para meets históricas em que syncMeetStatus não propagou
      // start/end (ex: entraram em ata_gerada antes do ended chegar).
      meeting_start_time: s.meeting_start_time || mp.meeting_start_time || null,
      meeting_end_time: s.meeting_end_time || mp.meeting_end_time || null,
      drive_folder_link: mp.drive_folder_link || null,
      recording_drive_link: mp.recording_drive_link || null,
      transcript_drive_link: mp.transcript_drive_link || null,
      smart_note_drive_link: mp.smart_note_drive_link || null,
      recording_original_link: mp.recording_original_link || null,
      transcript_original_link: mp.transcript_original_link || null,
      smart_note_original_link: mp.smart_note_original_link || null,
      governanca: gov,
      has_ata: !!(gov && gov.ata && gov.ata.trim().length > 0),
    };
  });

  // Sumário por status
  const summary = meetings.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {});

  return res.status(200).json({
    total: meetings.length,
    summary,
    meetings,
  });
}
