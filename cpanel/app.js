require("dotenv").config();
const express = require("express");
const cors = require("cors");
const logger = require("./src/utils/logger");
const { authorize } = require("./src/services/auth");
const { initializeSubscriptions, getSubscriptionStats } = require("./src/services/subscription");
const { startListening, getConferenceStatus, processCompleteConference } = require("./src/services/events");

const app = express();

const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
    : ["https://reuniao.lmedu.com.br", /^https:\/\/.+\.vercel\.app$/];

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());

const PORT = process.env.PORT || 4000;

// Health check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        subscriptions: getSubscriptionStats(),
        conferences: getConferenceStatus(),
    });
});

// Trigger manual de processamento de conferência
app.post("/api/send-webhook/:id", async (req, res) => {
    const conferenceId = `conferenceRecords/${req.params.id}`;
    logger.info(`Manual webhook trigger: ${conferenceId}`);
    try {
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
        logger.info("Service account authorized.");

        logger.info("Initializing subscriptions...");
        await initializeSubscriptions();
        logger.info("Subscriptions initialized.");

        logger.info("Starting Pub/Sub listener...");
        startListening();

        app.listen(PORT, () => {
            logger.info(`cPanel listener running on port ${PORT}`);
        });
    } catch (error) {
        logger.error("FATAL: Failed to start", { error: error.message, stack: error.stack });
        process.exit(1);
    }
}

startServer();
