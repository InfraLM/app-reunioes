import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Importar rotas do backend via createRequire (CJS → ESM seguro)
let authRoutes, reunioesRoutes, chatRoutes;
try {
  authRoutes = require('../backend/src/routes/auth.js');
  reunioesRoutes = require('../backend/src/routes/reunioes.js');
  chatRoutes = require('../backend/src/routes/chat.js');
} catch (error) {
  console.error('Error loading routes:', error);
}

const app = express();

// CORS
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];

app.use(cors({ origin: corsOrigins, credentials: true }));

app.use(express.json());

// Rotas
if (authRoutes) app.use('/api/auth', authRoutes);
if (reunioesRoutes) app.use('/api/reunioes', reunioesRoutes);
if (chatRoutes) app.use('/api/chat', chatRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Para Vercel serverless
export default (req, res) => {
  app(req, res);
};
