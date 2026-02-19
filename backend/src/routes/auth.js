const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
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
    res.json({
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
    res.status(500).json({
      error: 'Erro interno do servidor',
    });
  }
});

module.exports = router;
