require("dotenv").config();
const express = require("express");
const cors = require("cors");
const config = require("./config");
const logger = require("./utils/logger");
const { authorize } = require("./services/auth");
const { initializeSubscriptions, getSubscriptionStats } = require("./services/subscription");
const { startListening, getConferenceStatus, processCompleteConference } = require("./services/events");
const authRoutes = require("./routes/auth");
const reunioesRoutes = require("./routes/reunioes");
const chatRoutes = require("./routes/chat");

const app = express();

// ⭐ Configurar CORS
const productionOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : ['https://reuniao.lmedu.com.br'];

app.use(cors({
    origin: (origin, callback) => {
        // Permite qualquer origem localhost em dev (qualquer porta)
        if (!origin) return callback(null, true);
        try {
            const url = new URL(origin);
            if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
                return callback(null, true);
            }
        } catch (_) { }
        if (productionOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));

app.use(express.json());

// Servir arquivos estáticos (Dashboard HTML fallback)
app.use(express.static("public"));

// ⭐ NOVO: Rotas de autenticação e reuniões
app.use('/api/auth', authRoutes);
app.use('/api/reunioes', reunioesRoutes);
app.use('/api/chat', chatRoutes);
logger.info("✅ Rotas de autenticação, reuniões e chat carregadas.");

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// API para o Dashboard
app.get("/api/status", (req, res) => {
    res.json({
        subscriptions: getSubscriptionStats(),
        conferences: getConferenceStatus()
    });
});

// Endpoint para envio manual
app.post("/api/send-webhook/:id", async (req, res) => {
    const conferenceId = `conferenceRecords/${req.params.id}`;
    logger.info(`Manual webhook trigger requested for: ${conferenceId}`);
    try {
        // Dispara o processamento sem esperar (background) ou espera? 
        // Melhor esperar para dar feedback ao usuário
        await processCompleteConference(conferenceId);
        res.json({ success: true, message: "Envio disparado com sucesso!" });
    } catch (error) {
        logger.error(`Manual trigger failed for ${conferenceId}: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

async function startServer() {
    try {
        logger.info("Authorizing service account...");
        await authorize();
        logger.info("Service account authorized successfully.");

        logger.info("Initializing subscriptions for all monitored users...");
        await initializeSubscriptions();
        logger.info("Subscription initialization process completed.");

        logger.info("Starting to listen for Pub/Sub messages...");
        startListening();

        app.listen(config.app.port, () => {
            logger.info(`Server is running on port ${config.app.port}`);
            logger.info(`Dashboard available at http://localhost:${config.app.port}/monitor.html`);
        });
    } catch (error) {
        logger.error("FATAL: Failed to start the application", { error: error.message, stack: error.stack });
        process.exit(1);
    }
}

startServer();
