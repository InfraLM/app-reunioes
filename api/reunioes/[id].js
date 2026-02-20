import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Create an Express app for this specific endpoint
const app = express();

// CORS
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : ['https://reuniao.lmedu.com.br', /^https:\/\/.+\.vercel\.app$/];

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());

// Load the reunioes router
let reunioesRouter;
try {
  reunioesRouter = require('../../backend/src/routes/reunioes.js');
  app.use('/', reunioesRouter);
} catch (error) {
  console.error('Error loading reunioes routes:', error);
}

// Export serverless handler
export default (req, res) => {
  app(req, res);
};
