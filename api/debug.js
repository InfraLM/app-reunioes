import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * GET /api/debug
 * Debug endpoint para verificar configuração do Prisma
 */
export default async function handler(req, res) {
  try {
    const prisma = require('../lib/prisma.cjs');

    const debug = {
      prismaLoaded: !!prisma,
      models: {
        appsUsuarios: typeof prisma.appsUsuarios,
        eppReunioesGovernanca: typeof prisma.eppReunioesGovernanca,
        conferenceArtifactTracking: typeof prisma.conferenceArtifactTracking,
      },
      env: {
        DATABASE_URL: !!process.env.DATABASE_URL,
        JWT_SECRET: !!process.env.JWT_SECRET,
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
        NODE_ENV: process.env.NODE_ENV,
      },
      prismaVersion: require('../node_modules/@prisma/client/package.json').version,
    };

    // Teste de conexão
    try {
      await prisma.$connect();
      debug.connectionTest = 'SUCCESS';
      await prisma.$disconnect();
    } catch (error) {
      debug.connectionTest = 'FAILED';
      debug.connectionError = error.message;
    }

    return res.status(200).json(debug);
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack,
    });
  }
}
