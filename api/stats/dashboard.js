import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

const CUTOFF_DATE = new Date('2026-04-10T00:00:00Z');

/**
 * GET /api/stats/dashboard
 * Retorna agregados para a Home/Dashboard.
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

    const meetings = await prisma.eppMeetProcess.findMany({
      where: {
        OR: [
          { meeting_start_time: { gte: CUTOFF_DATE } },
          { meeting_start_time: null, first_event_at: { gte: CUTOFF_DATE } },
        ],
      },
      select: {
        conference_id: true,
        user_email: true,
        meeting_title: true,
        meeting_start_time: true,
        meeting_end_time: true,
        has_recording: true,
        has_transcript: true,
        has_smart_note: true,
        first_event_at: true,
        status: true,
      },
    });

    const total = meetings.length;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // domingo
    startOfWeek.setHours(0, 0, 0, 0);

    const getDate = (m) => m.meeting_start_time || m.first_event_at;

    // Ranking do mês atual (top 10 por quantidade)
    const rankMap = new Map();
    for (const m of meetings) {
      const d = getDate(m);
      if (!d || new Date(d) < startOfMonth) continue;
      rankMap.set(m.user_email, (rankMap.get(m.user_email) || 0) + 1);
    }
    const ranking = Array.from(rankMap.entries())
      .map(([user_email, count]) => ({ user_email, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Reuniões semanais: últimas 8 semanas (buckets)
    const weeklyBuckets = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(startOfWeek);
      start.setDate(startOfWeek.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      weeklyBuckets.push({ start, end, count: 0 });
    }
    let reunioesEstaSemana = 0;
    for (const m of meetings) {
      const d = getDate(m);
      if (!d) continue;
      const dt = new Date(d);
      for (const b of weeklyBuckets) {
        if (dt >= b.start && dt < b.end) {
          b.count += 1;
          break;
        }
      }
      if (dt >= startOfWeek) reunioesEstaSemana += 1;
    }
    const weekly = weeklyBuckets.map((b) => ({
      week_start: b.start.toISOString().slice(0, 10),
      count: b.count,
    }));

    // Comitês: título contém "comitê" ou "comitês" (case-insensitive, aceita "comite")
    const comiteRe = /comit[êe]s?/i;
    let comiteCount = 0;
    for (const m of meetings) {
      if (m.meeting_title && comiteRe.test(m.meeting_title)) comiteCount += 1;
    }
    const comitePie = [
      { name: 'Comitês', value: comiteCount },
      { name: 'Outras', value: Math.max(0, total - comiteCount) },
    ];

    // 1:1 — título contém "1:1", "1x1", "one-on-one" (case-insensitive, aceita espaços)
    const oneOnOneRe = /(\b1\s*[:xX×]\s*1\b|one[\s-]?on[\s-]?one)/i;
    let oneOnOneCount = 0;
    for (const m of meetings) {
      if (m.meeting_title && oneOnOneRe.test(m.meeting_title)) oneOnOneCount += 1;
    }
    const oneOnOnePie = [
      { name: '1:1', value: oneOnOneCount },
      { name: 'Outras', value: Math.max(0, total - oneOnOneCount) },
    ];

    // Distribuição por status (pie)
    const statusMap = new Map();
    for (const m of meetings) {
      statusMap.set(m.status || 'desconhecido', (statusMap.get(m.status || 'desconhecido') || 0) + 1);
    }
    const statusDist = Array.from(statusMap.entries()).map(([name, value]) => ({ name, value }));

    // Duração média em minutos
    let durSum = 0;
    let durCount = 0;
    for (const m of meetings) {
      if (m.meeting_start_time && m.meeting_end_time) {
        const ms = new Date(m.meeting_end_time).getTime() - new Date(m.meeting_start_time).getTime();
        if (ms > 0) {
          durSum += ms;
          durCount += 1;
        }
      }
    }
    const duracaoMediaMin = durCount > 0 ? Math.round(durSum / 60000 / durCount) : 0;

    // Artefatos (contagem de meetings com cada tipo)
    const artifactsCounts = {
      recording: meetings.filter((m) => m.has_recording).length,
      transcript: meetings.filter((m) => m.has_transcript).length,
      smart_note: meetings.filter((m) => m.has_smart_note).length,
    };

    return res.status(200).json({
      total,
      reunioes_mes: ranking.reduce((acc, r) => acc + r.count, 0),
      reunioes_semana: reunioesEstaSemana,
      duracao_media_min: duracaoMediaMin,
      ranking_mes: ranking,
      weekly,
      one_on_one_pie: oneOnOnePie,
      comite_pie: comitePie,
      status_dist: statusDist,
      artifacts_counts: artifactsCounts,
    });
  } catch (err) {
    console.error('[stats/dashboard] ERRO:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
