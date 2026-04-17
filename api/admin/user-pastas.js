import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * GET  /api/admin/user-pastas         — lista todas as user_pastas (JWT)
 * PATCH /api/admin/user-pastas body: { user_email, pasta_origem?, pasta_destino? } — atualiza (admin)
 *
 * GET é aberto a qualquer usuário autenticado (para visualização no painel).
 * PATCH requer cargo === 'admin' em apps_usuarios.
 */
export default async function handler(req, res) {
  // CORS
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

  // Autenticação JWT
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
    const rows = await prisma.eppUserPastas.findMany({ orderBy: { user_email: 'asc' } });
    return res.status(200).json({ total: rows.length, user_pastas: rows });
  }

  if (req.method === 'PATCH') {
    // Verifica cargo admin
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const authUser = await prisma.appsUsuarios.findUnique({
      where: { id: userId },
      select: { cargo: true },
    });
    const isAdmin = authUser?.cargo?.toLowerCase() === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Acesso restrito a admins', cargo: authUser?.cargo || null });
    }

    const { user_email, pasta_origem, pasta_destino } = req.body || {};
    if (!user_email) return res.status(400).json({ error: 'user_email é obrigatório' });

    const data = {};
    if (pasta_origem !== undefined) data.pasta_origem = pasta_origem || null;
    if (pasta_destino !== undefined) data.pasta_destino = pasta_destino || null;

    try {
      // UPSERT (caso o email não exista na tabela ainda)
      const row = await prisma.eppUserPastas.upsert({
        where: { user_email },
        update: data,
        create: { user_email, ...data },
      });
      console.log(`[user-pastas] ${userLogin} atualizou ${user_email}`);
      return res.status(200).json({ success: true, row });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
