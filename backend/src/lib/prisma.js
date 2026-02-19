const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não encontrado nas variáveis de ambiente');
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

console.log('🔍 Prisma inicializado');
console.log('DATABASE_URL presente:', !!process.env.DATABASE_URL);

module.exports = prisma;
