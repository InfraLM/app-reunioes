const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL não encontrado nas variáveis de ambiente');
}

const pool = new Pool({
  connectionString,
  max: 1, // Serverless = 1 conexão
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

// Log de inicialização
console.log('🔍 Inicializando Prisma...');
console.log('DATABASE_URL presente:', !!process.env.DATABASE_URL);

// Extrair host da DATABASE_URL para log (sem mostrar senha)
try {
  const url = new URL(connectionString);
  console.log('Host:', `${url.hostname}:${url.port}`);
} catch (e) {
  console.log('Erro ao parsear DATABASE_URL');
}

module.exports = prisma;
