import express from 'express';
import prisma from '../lib/prisma.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Todas as rotas protegidas por autenticação
router.use(authMiddleware);

// GET /api/reunioes - Listar reuniões com filtros opcionais
router.get('/', async (req, res) => {
  try {
    const {
      data_inicio,
      data_fim,
      responsavel,
      limit = '50',
      offset = '0',
    } = req.query;

    const where: any = {};

    // Filtro por período
    if (data_inicio && data_fim) {
      where.data_reuniao = {
        gte: new Date(data_inicio as string),
        lte: new Date(data_fim as string),
      };
    }

    // Filtro por responsável (busca parcial, case-insensitive)
    if (responsavel) {
      where.responsavel = {
        contains: responsavel as string,
        mode: 'insensitive',
      };
    }

    // Buscar reuniões e total
    const [reunioes, total] = await Promise.all([
      prisma.eppReunioesGovernanca.findMany({
        where,
        orderBy: { data_reuniao: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      }),
      prisma.eppReunioesGovernanca.count({ where }),
    ]);

    res.json({
      data: reunioes,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error) {
    console.error('Erro ao buscar reuniões:', error);
    res.status(500).json({ error: 'Erro ao buscar reuniões' });
  }
});

// GET /api/reunioes/:id - Detalhes de uma reunião específica
router.get('/:id', async (req, res) => {
  try {
    const reuniao = await prisma.eppReunioesGovernanca.findUnique({
      where: { id: req.params.id },
    });

    if (!reuniao) {
      return res.status(404).json({ error: 'Reunião não encontrada' });
    }

    res.json(reuniao);
  } catch (error) {
    console.error('Erro ao buscar reunião:', error);
    res.status(500).json({ error: 'Erro ao buscar reunião' });
  }
});

export default router;
