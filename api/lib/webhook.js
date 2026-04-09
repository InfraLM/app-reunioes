const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

/**
 * Envia o payload final da reunião para o webhook de destino.
 *
 * Payload esperado:
 * {
 *   conference_id: string,
 *   meeting_title: string,
 *   start_time: string (ISO 8601),
 *   end_time: string (ISO 8601),
 *   recording_url: string | null,
 *   transcript_url: string | null,
 *   smart_notes_url: string | null,
 *   account_email: string,
 *   partial?: boolean,
 *   missing_artifacts?: string[]
 * }
 */
async function sendWebhook(payload) {
  try {
    logger.info('Sending webhook...', { url: config.webhook.destinationUrl, payload });
    const response = await axios.post(config.webhook.destinationUrl, payload);
    logger.info('Webhook sent successfully', { status: response.status });
    return response.data;
  } catch (error) {
    logger.error('Failed to send webhook', { error: error.response?.data || error.message });
    throw error;
  }
}

module.exports = { sendWebhook };
