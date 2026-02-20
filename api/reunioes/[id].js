import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Import dependencies
const prisma = require('../../backend/src/lib/prisma');
const jwt = require('jsonwebtoken');

/**
 * GET /api/reunioes/:id
 * Retorna detalhes de uma reunião específica
 * Requer autenticação
 */
export default async function handler(req, res) {
  // Set CORS headers
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];

  const origin = req.headers.origin;
  const isAllowed = corsOrigins.some(allowed =>
    allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
  );

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authentication middleware
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    try {
      jwt.verify(token, process.env.JWT_SECRET || 'secret-default');
    } catch (error) {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }

    // Get ID from query (Vercel passes dynamic segments as query params)
    const id = req.query.id;
    if (!id) {
      return res.status(400).json({ error: 'ID não fornecido' });
    }

    // Fetch reunião
    const reuniao = await prisma.eppReunioesGovernanca.findUnique({
      where: { id },
    });

    if (!reuniao) {
      return res.status(404).json({ error: 'Reunião não encontrada' });
    }

    return res.status(200).json(reuniao);
  } catch (error) {
    console.error('Erro ao buscar reunião:', error);
    return res.status(500).json({ error: 'Erro ao buscar reunião' });
  }
}
