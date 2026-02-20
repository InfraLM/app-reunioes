const { google } = require("googleapis");
const { ConferenceRecordsServiceClient } = require('@google-apps/meet').v2;
const { getAuthClient, getAuthClientForUser } = require("../services/auth");
const logger = require("../utils/logger");

/**
 * Retorna o cliente especializado do Google Meet v2
 */
function getMeetClient(impersonatedEmail) {
    const auth = impersonatedEmail ? getAuthClientForUser(impersonatedEmail) : getAuthClient();
    // A biblioteca @google-apps/meet usa o authClient diretamente no construtor
    return new ConferenceRecordsServiceClient({
        authClient: auth
    });
}

function getDriveApiClient() {
    const auth = getAuthClient();
    return google.drive({ version: "v3", auth });
}

async function getConferenceDetails(conferenceId, impersonatedEmail) {
    try {
        const client = getMeetClient(impersonatedEmail);
        const [response] = await client.getConferenceRecord({ name: conferenceId });
        logger.info(`Conference details retrieved for: ${conferenceId}`, { details: response });
        return response;
    } catch (error) {
        logger.error(`Failed to get conference details for: ${conferenceId}`, { error: error.message });
        throw error;
    }
}

async function getRecording(recordingName, impersonatedEmail) {
    try {
        const client = getMeetClient(impersonatedEmail);
        const [response] = await client.getRecording({ name: recordingName });
        logger.info(`Recording details retrieved for: ${recordingName}`, { details: response });
        return response;
    } catch (error) {
        logger.error(`Failed to get recording details for: ${recordingName}`, { error: error.message });
        throw error;
    }
}

async function getTranscript(transcriptName, impersonatedEmail) {
    try {
        const client = getMeetClient(impersonatedEmail);
        const [response] = await client.getTranscript({ name: transcriptName });
        logger.info(`Transcript details retrieved for: ${transcriptName}`, { details: response });
        return response;
    } catch (error) {
        logger.error(`Failed to get transcript details for: ${transcriptName}`, { error: error.message });
        throw error;
    }
}

async function getSmartNote(smartNoteName, impersonatedEmail) {
    try {
        const client = getMeetClient(impersonatedEmail);
        // Nota: Smart Notes pode estar em v2beta ou similar, mas tentamos no client v2 padrão primeiro
        // O método correto na API é getSmartNote
        const [response] = await client.getSmartNote({ name: smartNoteName });
        logger.info(`Smart Note details retrieved for: ${smartNoteName}`, { details: response });
        return response;
    } catch (error) {
        logger.error(`Failed to get smart note details for: ${smartNoteName}`, { error: error.message });
        throw error;
    }
}

function getGoogleDriveLink(fileId) {
    return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Busca email do usuário usando Directory API
 * @param {string} userId - ID do usuário (formato: users/123456789 ou apenas 123456789)
 * @returns {string|null} Email do usuário ou null se não encontrado
 */
async function getUserEmailFromDirectory(userId) {
    try {
        // Extrair apenas o número do ID
        const userIdMatch = userId.match(/(\d+)/);
        if (!userIdMatch) {
            logger.warn(`ID de usuário inválido: ${userId}`);
            return null;
        }

        const numericUserId = userIdMatch[1];
        const auth = getAuthClient();
        const admin = google.admin({ version: 'directory_v1', auth });

        // Buscar usuário pelo ID
        const response = await admin.users.get({
            userKey: numericUserId
        });

        const email = response.data.primaryEmail;
        logger.info(`Email encontrado para user ID ${numericUserId}: ${email}`);
        return email;

    } catch (error) {
        logger.error(`Erro ao buscar email do usuário ${userId}:`, error.message);
        return null;
    }
}

module.exports = {
    getConferenceDetails,
    getGoogleDriveLink,
    getRecording,
    getTranscript,
    getSmartNote,
    getUserEmailFromDirectory
};
