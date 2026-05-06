import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

// Cotação USD→BRL fixa pra simplicidade. Pode virar env var se precisar.
const BRL_PER_USD = Number(process.env.BRL_PER_USD || 5.2);

/**
 * GET /api/stats/ai-usage?period=today|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Retorna agregados de uso da API de IA (tracking gravado em epp_ai_usage):
 *   - totals (calls, tokens, custo USD/BRL)
 *   - breakdown por dia (pra gráfico)
 *   - últimas chamadas (pra tabela)
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
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
    } catch {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const period = String(req.query.period || '30d');
    const fromQ = req.query.from ? String(req.query.from) : null;
    const toQ = req.query.to ? String(req.query.to) : null;

    const now = new Date();
    let from = null;
    let to = null;

    if (period === 'custom') {
      if (fromQ) from = new Date(`${fromQ}T00:00:00Z`);
      if (toQ) to = new Date(`${toQ}T23:59:59Z`);
    } else if (period === 'today') {
      from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (period === '7d') {
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === '30d') {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } // 'all' deixa from=null = sem filtro inferior

    const where = {};
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at.gte = from;
      if (to) where.created_at.lte = to;
    }

    const rows = await prisma.eppAiUsage.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 5000, // teto de segurança
    });

    let totalCalls = 0;
    let totalSuccess = 0;
    let totalError = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheCreate = 0;
    let totalCacheRead = 0;
    let totalCostUsd = 0;
    const byDay = new Map();

    for (const r of rows) {
      totalCalls += 1;
      if (r.status === 'success') totalSuccess += 1; else totalError += 1;
      const inp = Number(r.input_tokens || 0);
      const out = Number(r.output_tokens || 0);
      const cc = Number(r.cache_creation_tokens || 0);
      const cr = Number(r.cache_read_tokens || 0);
      const cost = Number(r.cost_usd || 0);
      totalInput += inp;
      totalOutput += out;
      totalCacheCreate += cc;
      totalCacheRead += cr;
      totalCostUsd += cost;

      const day = r.created_at.toISOString().slice(0, 10);
      const acc = byDay.get(day) || { day, calls: 0, input: 0, output: 0, cost_usd: 0 };
      acc.calls += 1;
      acc.input += inp;
      acc.output += out;
      acc.cost_usd += cost;
      byDay.set(day, acc);
    }

    const dailySeries = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));

    // Últimas 50 chamadas pra tabela
    const recent = rows.slice(0, 50).map((r) => ({
      id: r.id.toString(),
      created_at: r.created_at,
      conference_id: r.conference_id || null,
      endpoint: r.endpoint,
      model: r.model,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_creation_tokens: r.cache_creation_tokens,
      cache_read_tokens: r.cache_read_tokens,
      cost_usd: Number(r.cost_usd || 0),
      status: r.status,
      error_message: r.error_message,
    }));

    return res.status(200).json({
      period,
      from: from?.toISOString() || null,
      to: to?.toISOString() || null,
      brl_per_usd: BRL_PER_USD,
      totals: {
        calls: totalCalls,
        success: totalSuccess,
        error: totalError,
        input_tokens: totalInput,
        output_tokens: totalOutput,
        cache_creation_tokens: totalCacheCreate,
        cache_read_tokens: totalCacheRead,
        cost_usd: Number(totalCostUsd.toFixed(6)),
        cost_brl: Number((totalCostUsd * BRL_PER_USD).toFixed(4)),
      },
      daily: dailySeries.map((d) => ({
        ...d,
        cost_usd: Number(d.cost_usd.toFixed(6)),
        cost_brl: Number((d.cost_usd * BRL_PER_USD).toFixed(4)),
      })),
      recent,
    });
  } catch (err) {
    console.error('[stats/ai-usage] ERRO:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
