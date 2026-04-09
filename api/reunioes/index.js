import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Import dependencies
const prisma = require('../../lib/prisma.cjs');
const jwt = require('jsonwebtoken');

/**
 * GET /api/reunioes
 * Lista reuniões de governança com filtros opcionais
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

    // Get query parameters
    const {
      data_inicio,
      data_fim,
      responsavel,
      limit = '50',
      offset = '0',
    } = req.query;

    const where = {};

    // Filtro por período
    if (data_inicio && data_fim) {
      where.data_reuniao = {
        gte: new Date(data_inicio),
        lte: new Date(data_fim),
      };
    }

    // Filtro por responsável (busca parcial, case-insensitive)
    if (responsavel) {
      where.responsavel = {
        contains: responsavel,
        mode: 'insensitive',
      };
    }

    // Buscar reuniões e total
    const [reunioes, total] = await Promise.all([
      prisma.eppReunioesGovernanca.findMany({
        where,
        orderBy: { data_reuniao: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.eppReunioesGovernanca.count({ where }),
    ]);

    return res.status(200).json({
      data: reunioes,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Erro ao buscar reuniões:', error);
    return res.status(500).json({ error: 'Erro ao buscar reuniões' });
  }
}
