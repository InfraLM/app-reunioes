import 'dotenv/config';
import express from 'express';
import cors from 'cors';

process.env.NODE_ENV = 'production';

// Importar rotas compiladas do backend
let authRoutes, reunioesRoutes, chatRoutes;
try {
  authRoutes = (await import('../backend/dist/routes/auth.js')).default;
  reunioesRoutes = (await import('../backend/dist/routes/reunioes.js')).default;
  chatRoutes = (await import('../backend/dist/routes/chat.js')).default;
} catch (error) {
  console.error('Error loading routes:', error);
}

const app = express();

// CORS
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['https://reuniao.lmedu.com.br', 'https://*.vercel.app'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.some(allowed => {
        if (allowed.includes('*')) {
          const regex = new RegExp(allowed.replace('*', '.*'));
          return regex.test(origin);
        }
        return allowed === origin;
      })) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// Rotas
if (authRoutes) app.use('/api/auth', authRoutes);
if (reunioesRoutes) app.use('/api/reunioes', reunioesRoutes);
if (chatRoutes) app.use('/api/chat', chatRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
