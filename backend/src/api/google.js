const { google } = require("googleapis");
const { ConferenceRecordsServiceClient } = require('@google-apps/meet').v2;
const { getAuthClient, getAuthClientForUser } = require("../services/auth");
const logger = require("../utils/logger");
const config = require("../config");

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

/**
 * Retorna o cliente especializado do Google Drive v3 para um usuário personificado
 */
function getDriveApiClientForUser(impersonatedEmail) {
    const auth = getAuthClientForUser(impersonatedEmail);
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
 * Copies a Google Drive file to a shared folder and returns its web view link.
 * Sets permissions for anyone with the link to view.
 * @param {string} fileId The ID of the file to copy.
 * @param {string} impersonatedEmail The email of the user to impersonate.
 * @param {string} sharedFolderId The ID of the shared Google Drive folder.
 * @returns {Promise<string|null>} The web view link of the copied file, or null if an error occurs.
 */
async function copyFileToSharedFolderAndGetLink(fileId, impersonatedEmail, sharedFolderId) {
  if (!fileId || !impersonatedEmail || !sharedFolderId) {
    logger.warn('Missing parameters for copyFileToSharedFolderAndGetLink', { fileId, impersonatedEmail, sharedFolderId });
    return null;
  }

  try {
    const drive = getDriveApiClientForUser(impersonatedEmail);

    // 1. Copy the file to the shared folder
    const copyResponse = await drive.files.copy({
      fileId: fileId,
      requestBody: {
        parents: [sharedFolderId],
      },
      fields: 'id,webViewLink,name',
      supportsAllDrives: true, // Required for Shared Drives
    });

    const copiedFile = copyResponse.data;
    logger.info(`File ${fileId} copied to folder ${sharedFolderId}. New file ID: ${copiedFile.id}`);

    // 2. Set permissions on the copied file to be publicly readable
    await drive.permissions.create({
      fileId: copiedFile.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
      supportsAllDrives: true, // Required for Shared Drives
    });
    logger.info(`Permissions set for copied file ${copiedFile.id}: anyone with link can view.`);

    return copiedFile.webViewLink;
  } catch (error) {
    logger.error(`Error copying file ${fileId} to shared folder ${sharedFolderId}:`, error.response ? error.response.data : error);
    return null;
  }
}

/**
 * Busca email do usuário usando Directory API
 * @param {string} subject - Subject do evento (formato: //cloudidentity.googleapis.com/users/123456789 ou users/123456789)
 * @returns {string|null} Email do usuário ou null se não encontrado
 */
async function getUserEmailFromDirectory(subject) {
    try {
        // Extrair apenas o número do ID (suporta vários formatos)
        // Formatos suportados:
        // - //cloudidentity.googleapis.com/users/123456789
        // - users/123456789
        // - 123456789
        const userIdMatch = subject.match(/users\/(\d+)|^(\d+)$/);
        if (!userIdMatch) {
            logger.warn(`ID de usuário inválido: ${subject}`);
            return null;
        }

        const numericUserId = userIdMatch[1] || userIdMatch[2];
        logger.info(`Buscando email para user ID: ${numericUserId}`);

        const auth = getAuthClient();
        const admin = google.admin({ version: 'directory_v1', auth });

        // Buscar usuário pelo ID
        const response = await admin.users.get({
            userKey: numericUserId,
            projection: 'basic', // Retorna apenas campos básicos (mais rápido)
            viewType: 'admin_view'
        });

        const email = response.data.primaryEmail;
        logger.info(`✅ Email encontrado: ${email} (user ID: ${numericUserId})`);
        return email;

    } catch (error) {
        logger.error(`❌ Erro ao buscar email do usuário ${subject}:`, {
            message: error.message,
            code: error.code,
            status: error.status
        });

        // Se o erro for de permissão, logar detalhes adicionais
        if (error.code === 403) {
            logger.error('⚠️ Permissão negada! Verifique se o Service Account tem acesso ao Directory API');
            logger.error('Scopes necessários: https://www.googleapis.com/auth/admin.directory.user.readonly');
        }

        return null;
    }
}

module.exports = {
    getConferenceDetails,
    getGoogleDriveLink,
    getRecording,
    getTranscript,
    getSmartNote,
    getUserEmailFromDirectory,
    copyFileToSharedFolderAndGetLink,
};
