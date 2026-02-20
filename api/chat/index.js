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

// Load the chat router
let chatRouter;
try {
  chatRouter = require('../../backend/src/routes/chat.js');
  app.use('/', chatRouter);
} catch (error) {
  console.error('Error loading chat routes:', error);
}

// Export serverless handler
export default (req, res) => {
  app(req, res);
};
