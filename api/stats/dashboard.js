import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

const CUTOFF_DATE = new Date('2026-04-09T00:00:00Z');

const GENERIC_TITLES = new Set([
  'reuniao instantanea',
  'reuniao do google meet',
]);

/** Remove acentos e normaliza para comparação case-insensitive. */
function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const COMITE_RE = /\bcomite[s]?\b/i;
const ONE_ON_ONE_RE = /(\b1\s*[:xX×-]\s*1\b|\bone[\s-]?(on|to)[\s-]?one\b)/i;

/** Classifica um título em comitê / 1:1 usando regex normalizadas. */
function classifyTitle(rawTitle) {
  const normalized = normalizeTitle(rawTitle);
  if (!normalized || GENERIC_TITLES.has(normalized)) {
    return { isComite: false, isOneOnOne: false };
  }
  return {
    isComite: COMITE_RE.test(normalized),
    isOneOnOne: ONE_ON_ONE_RE.test(normalized),
  };
}

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

    const [meetings, governancas] = await Promise.all([
      prisma.eppMeetProcess.findMany({
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
      }),
      // Governanca traz o titulo_reuniao gerado pela IA a partir da transcrição
      // — é mais fiel ao que foi marcado no Calendar (ex: "Comitê MBX",
      // "1:1 Fulano") que o meeting_title do Meet API, que muitas vezes fica
      // "Reunião instantânea".
      prisma.eppReunioesGovernanca.findMany({
        select: { conference_id: true, titulo_reuniao: true },
      }),
    ]);
    const govTitleMap = new Map(
      governancas.filter((g) => g.titulo_reuniao).map((g) => [g.conference_id, g.titulo_reuniao])
    );

    /** Título priorizando governanca (IA) sobre meeting_title (Meet/Drive). */
    const bestTitle = (m) => govTitleMap.get(m.conference_id) || m.meeting_title || null;

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

    // Classifica cada reunião pelo melhor título disponível (governanca > meeting_title),
    // aplicando regex normalizadas (acentos + case + separadores variados em 1:1).
    let comiteCount = 0;
    let oneOnOneCount = 0;
    let tituloGenericoCount = 0;
    for (const m of meetings) {
      const title = bestTitle(m);
      if (!title) {
        tituloGenericoCount += 1;
        continue;
      }
      const { isComite, isOneOnOne } = classifyTitle(title);
      if (isComite) comiteCount += 1;
      if (isOneOnOne) oneOnOneCount += 1;
      if (!isComite && !isOneOnOne && GENERIC_TITLES.has(normalizeTitle(title))) {
        tituloGenericoCount += 1;
      }
    }
    const comitePie = [
      { name: 'Comitês', value: comiteCount },
      { name: 'Outras', value: Math.max(0, total - comiteCount) },
    ];
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
      titulos_genericos: tituloGenericoCount,
    });
  } catch (err) {
    console.error('[stats/dashboard] ERRO:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
