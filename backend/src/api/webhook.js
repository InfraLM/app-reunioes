const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

async function sendWebhook(payload) {
    try {
        logger.info("Sending webhook...", { url: config.webhook.destinationUrl, payload });
        const response = await axios.post(config.webhook.destinationUrl, payload);
        logger.info("Webhook sent successfully", { status: response.status });
        return response.data;
    } catch (error) {
        logger.error("Failed to send webhook", { error: error.response?.data || error.message });
        throw error;
    }
}

module.exports = { sendWebhook };
