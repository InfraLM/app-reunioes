import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Import dependencies directly
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma.cjs');

/**
 * POST /api/auth/login
 * Autentica um usuário e retorna um token JWT
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { login, senha } = req.body;
    console.log('🔐 Tentativa de login:', login);

    // Validação de entrada
    if (!login || !senha) {
      console.log('❌ Login/senha não fornecidos');
      return res.status(400).json({
        error: 'Login e senha são obrigatórios',
      });
    }

    // Buscar usuário no banco
    const usuario = await prisma.appsUsuarios.findFirst({
      where: {
        login: login,
        reuniao: true, // Apenas usuários com permissão de acesso
      },
    });

    console.log('👤 Usuário encontrado:', !!usuario);
    console.log('🔑 Tem senha no banco:', !!usuario?.senha);
    console.log('✅ Tem permissão reuniao:', usuario?.reuniao);

    // Usuário não encontrado ou sem permissão
    if (!usuario || !usuario.senha) {
      console.log('❌ Usuário não encontrado ou sem senha');
      return res.status(401).json({
        error: 'Credenciais inválidas',
      });
    }

    // Verificar senha com bcrypt
    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    console.log('🔒 Senha válida:', senhaValida);

    if (!senhaValida) {
      console.log('❌ Senha incorreta');
      return res.status(401).json({
        error: 'Credenciais inválidas',
      });
    }

    // Gerar token JWT
    const token = jwt.sign(
      {
        id: usuario.id,
        login: usuario.login,
        nome: usuario.nome,
      },
      process.env.JWT_SECRET || 'secret-key-default',
      { expiresIn: '8h' } // Token válido por 8 horas
    );

    console.log('✅ Login bem-sucedido para:', usuario.login);

    // Retornar token e dados do usuário (sem a senha)
    return res.status(200).json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        login: usuario.login,
        cargo: usuario.cargo,
      },
    });
  } catch (error) {
    console.error('Erro no login:', error);
    return res.status(500).json({
      error: 'Erro interno do servidor',
    });
  }
}
