import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * GET  /api/admin/settings             — lista todas as settings (JWT autenticado)
 * PATCH /api/admin/settings body: { key, value } — upsert (admin-only)
 *
 * Exemplo: { key: "auto_ata", value: "true" | "false" }
 */
export default async function handler(req, res) {
  const origin = req.headers.origin;
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];
  const allowed = corsOrigins.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin));
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let userId = null;
  let userLogin = null;
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
    userId = decoded.id;
    userLogin = decoded.login;
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  if (req.method === 'GET') {
    const rows = await prisma.eppAppSettings.findMany({ orderBy: { key: 'asc' } });
    return res.status(200).json({ total: rows.length, settings: rows });
  }

  if (req.method === 'PATCH') {
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const authUser = await prisma.appsUsuarios.findUnique({
      where: { id: userId },
      select: { cargo: true },
    });
    const isAdmin = authUser?.cargo?.toLowerCase() === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Acesso restrito a admins', cargo: authUser?.cargo || null });
    }

    const { key, value } = req.body || {};
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'key é obrigatório' });
    }
    if (value !== null && typeof value !== 'string') {
      return res.status(400).json({ error: 'value deve ser string ou null' });
    }

    try {
      const row = await prisma.eppAppSettings.upsert({
        where: { key },
        update: { value, updated_at: new Date() },
        create: { key, value },
      });
      console.log(`[settings] ${userLogin} atualizou ${key}=${value}`);
      return res.status(200).json({ success: true, setting: row });
    } catch (err) {
      console.error(`[settings] erro: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
