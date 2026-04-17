const { google } = require('googleapis');
const logger = require('./logger');
const config = require('./config');

// Lazy-load do SDK @google-apps/meet (tem binding gRPC que quebra em alguns ambientes)
let _meetSdk = null;
function loadMeetSdk() {
  if (_meetSdk) return _meetSdk;
  _meetSdk = require('@google-apps/meet').v2;
  return _meetSdk;
}

// ============================================================
// AUTENTICAÇÃO
// ============================================================

/**
 * Cria um cliente JWT para a Service Account impersonando um usuário específico.
 * Usado para acessar Meet API e Drive API em nome de cada usuário monitorado.
 */
function getAuthClientForUser(userEmail) {
  return new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: config.google.scopes,
    subject: userEmail,
  });
}

/**
 * Cria um cliente JWT para a Service Account impersonando o admin.
 * Usado para chamadas ao Admin SDK Directory API.
 */
function getAdminAuthClient() {
  return new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: config.google.scopes,
    subject: config.google.impersonatedUser,
  });
}

// ============================================================
// GOOGLE MEET API v2 / v2beta
// ============================================================

/**
 * Retorna o cliente SDK do Google Meet v2 para um usuário impersonado.
 */
function getMeetClient(impersonatedEmail) {
  const auth = getAuthClientForUser(impersonatedEmail);
  const { ConferenceRecordsServiceClient } = loadMeetSdk();
  return new ConferenceRecordsServiceClient({ authClient: auth });
}

/**
 * Busca os detalhes de uma conferência pelo nome do recurso.
 * @param {string} conferenceId - ex: "conferenceRecords/abc123"
 * @param {string} impersonatedEmail - e-mail do organizador
 */
async function getConferenceDetails(conferenceId, impersonatedEmail) {
  try {
    const client = getMeetClient(impersonatedEmail);
    const [response] = await client.getConferenceRecord({ name: conferenceId });
    logger.info(`Conference details retrieved for: ${conferenceId}`);
    return response;
  } catch (error) {
    logger.error(`Failed to get conference details for: ${conferenceId}`, { error: error.message });
    throw error;
  }
}

/**
 * Busca os detalhes de uma gravação.
 * Retorna: { driveDestination: { file, exportUri }, state, ... }
 * @param {string} recordingName - ex: "conferenceRecords/abc/recordings/xyz"
 * @param {string} impersonatedEmail
 */
async function getRecording(recordingName, impersonatedEmail) {
  try {
    const client = getMeetClient(impersonatedEmail);
    const [response] = await client.getRecording({ name: recordingName });
    logger.info(`Recording details retrieved for: ${recordingName}`);
    return response;
  } catch (error) {
    logger.error(`Failed to get recording details for: ${recordingName}`, { error: error.message });
    throw error;
  }
}

/**
 * Busca os detalhes de uma transcrição.
 * Retorna: { docsDestination: { document, exportUri }, state, ... }
 * @param {string} transcriptName - ex: "conferenceRecords/abc/transcripts/xyz"
 * @param {string} impersonatedEmail
 */
async function getTranscript(transcriptName, impersonatedEmail) {
  try {
    const client = getMeetClient(impersonatedEmail);
    const [response] = await client.getTranscript({ name: transcriptName });
    logger.info(`Transcript details retrieved for: ${transcriptName}`);
    return response;
  } catch (error) {
    logger.error(`Failed to get transcript details for: ${transcriptName}`, { error: error.message });
    throw error;
  }
}

/**
 * Busca os detalhes de uma Smart Note (API v2 — GA desde abril/2026).
 * Retorna: { docsDestination: { document, exportUri }, state, ... }
 * @param {string} smartNoteName - ex: "conferenceRecords/abc/smartNotes/xyz"
 * @param {string} impersonatedEmail
 */
async function getSmartNote(smartNoteName, impersonatedEmail) {
  try {
    const auth = getAuthClientForUser(impersonatedEmail);
    const { token } = await auth.getAccessToken();
    const url = `https://meet.googleapis.com/v2/${smartNoteName}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    logger.info(`Smart Note details retrieved for: ${smartNoteName}`);
    return data;
  } catch (error) {
    logger.error(`Failed to get smart note details for: ${smartNoteName}`, { error: error.message });
    throw error;
  }
}

/**
 * Lista todas as gravações de uma conferência.
 */
async function listConferenceRecordings(conferenceId, impersonatedEmail) {
  try {
    const client = getMeetClient(impersonatedEmail);
    const [recordings] = await client.listRecordings({ parent: conferenceId });
    logger.info(`Recordings listados para ${conferenceId}: ${recordings?.length || 0} encontrados`);
    return recordings || [];
  } catch (error) {
    logger.error(`Falha ao listar recordings para ${conferenceId}:`, { error: error.message });
    throw error;
  }
}

/**
 * Lista todas as transcrições de uma conferência.
 */
async function listConferenceTranscripts(conferenceId, impersonatedEmail) {
  try {
    const client = getMeetClient(impersonatedEmail);
    const [transcripts] = await client.listTranscripts({ parent: conferenceId });
    logger.info(`Transcripts listados para ${conferenceId}: ${transcripts?.length || 0} encontrados`);
    return transcripts || [];
  } catch (error) {
    logger.error(`Falha ao listar transcripts para ${conferenceId}:`, { error: error.message });
    throw error;
  }
}

/**
 * Lista todas as Smart Notes de uma conferência (API v2 — GA desde abril/2026).
 */
async function listConferenceSmartNotes(conferenceId, impersonatedEmail) {
  try {
    const auth = getAuthClientForUser(impersonatedEmail);
    const { token } = await auth.getAccessToken();
    const url = `https://meet.googleapis.com/v2/${conferenceId}/smartNotes`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    const smartNotes = data.smartNotes || [];
    logger.info(`Smart notes listados para ${conferenceId}: ${smartNotes.length} encontrados`);
    return smartNotes;
  } catch (error) {
    logger.error(`Falha ao listar smart notes para ${conferenceId}:`, { error: error.message });
    throw error;
  }
}

// ============================================================
// ADMIN SDK DIRECTORY API
// ============================================================

/**
 * Converte o subject do evento Pub/Sub (ID numérico do Cloud Identity)
 * em um endereço de e-mail institucional.
 *
 * Formatos suportados para o subject:
 *   - "//cloudidentity.googleapis.com/users/123456789"
 *   - "users/123456789"
 *   - "123456789"
 *
 * @param {string} subject
 * @returns {Promise<string|null>} E-mail do usuário ou null se não encontrado
 */
async function getUserEmailFromDirectory(subject) {
  try {
    const userIdMatch = subject.match(/users\/(\d+)|^(\d+)$/);
    if (!userIdMatch) {
      logger.warn(`ID de usuário inválido: ${subject}`);
      return null;
    }
    const numericUserId = userIdMatch[1] || userIdMatch[2];
    logger.info(`Buscando email para user ID: ${numericUserId}`);

    const auth = getAdminAuthClient();
    const admin = google.admin({ version: 'directory_v1', auth });
    const response = await admin.users.get({
      userKey: numericUserId,
      projection: 'basic',
      viewType: 'admin_view',
    });

    const email = response.data.primaryEmail;
    logger.info(`Email encontrado: ${email} (user ID: ${numericUserId})`);
    return email;
  } catch (error) {
    logger.error(`Erro ao buscar email do usuário ${subject}:`, {
      message: error.message,
      code: error.code,
    });
    if (error.code === 403) {
      logger.error('Permissão negada! Verifique se o Service Account tem acesso ao Directory API.');
    }
    return null;
  }
}

// ============================================================
// GOOGLE DRIVE API v3
// ============================================================

/**
 * Retorna o cliente do Google Drive v3 para um usuário impersonado.
 */
function getDriveClientForUser(impersonatedEmail) {
  const auth = getAuthClientForUser(impersonatedEmail);
  return google.drive({ version: 'v3', auth });
}

/**
 * Copia um arquivo do Drive para uma pasta compartilhada e define permissão pública.
 * Útil para garantir que os links dos artefatos sejam acessíveis por qualquer pessoa.
 *
 * @param {string} fileId - ID do arquivo original
 * @param {string} impersonatedEmail - E-mail do usuário dono do arquivo
 * @param {string} sharedFolderId - ID da pasta de destino (Shared Drive ou pasta compartilhada)
 * @returns {Promise<string|null>} webViewLink do arquivo copiado, ou null em caso de erro
 */
async function copyFileToSharedFolderAndGetLink(fileId, impersonatedEmail, sharedFolderId) {
  if (!fileId || !impersonatedEmail || !sharedFolderId) {
    logger.warn('Missing parameters for copyFileToSharedFolderAndGetLink', { fileId, impersonatedEmail, sharedFolderId });
    return null;
  }
  try {
    const drive = getDriveClientForUser(impersonatedEmail);
    const copyResponse = await drive.files.copy({
      fileId,
      requestBody: { parents: [sharedFolderId] },
      fields: 'id,webViewLink,name',
      supportsAllDrives: true,
    });
    const copiedFile = copyResponse.data;
    await drive.permissions.create({
      fileId: copiedFile.id,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    });
    return copiedFile.webViewLink;
  } catch (error) {
    logger.error(`Error copying file ${fileId} to shared folder ${sharedFolderId}:`, error.response?.data || error.message);
    return null;
  }
}

/**
 * Escapa aspas simples para uso em queries do Drive (q= parameter).
 */
function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Busca uma pasta filha pelo nome dentro de uma pasta pai.
 * Retorna o fileId da pasta encontrada, ou null.
 */
async function findFolderByName(parentId, folderName, impersonatedEmail) {
  const drive = getDriveClientForUser(impersonatedEmail);
  const q = `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const { data } = await drive.files.list({
    q,
    fields: 'files(id,name,webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return data.files?.[0] || null;
}

/**
 * Cria uma pasta filha dentro de uma pasta pai. Retorna { id, webViewLink, name }.
 */
async function createFolder(parentId, folderName, impersonatedEmail) {
  const drive = getDriveClientForUser(impersonatedEmail);
  const { data } = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  logger.info(`Pasta criada: ${folderName} (id=${data.id}) em ${parentId}`);
  return data;
}

/**
 * Retorna a pasta do usuário (busca por folderName) dentro da pasta raiz;
 * cria se não existir. Retorna { id, name, webViewLink }.
 * @param {string} parentId - ID da pasta raiz (GOOGLE_SHARED_DRIVE_FOLDER_ID)
 * @param {string} folderName - Nome da pasta (ex: "Yuri Ribeiro", não o email)
 * @param {string} impersonatedEmail - Email para DWD auth
 */
async function getOrCreateUserFolder(parentId, folderName, impersonatedEmail) {
  const existing = await findFolderByName(parentId, folderName, impersonatedEmail);
  if (existing) return existing;
  logger.info(`Pasta "${folderName}" não encontrada em ${parentId}. Criando.`);
  return createFolder(parentId, folderName, impersonatedEmail);
}

/**
 * Copia um arquivo para uma pasta específica. Define permissão "anyone reader".
 * Retorna { id, webViewLink, name } ou lança erro.
 */
async function copyFileToFolder(fileId, destinationFolderId, newName, impersonatedEmail) {
  const drive = getDriveClientForUser(impersonatedEmail);
  const requestBody = { parents: [destinationFolderId] };
  if (newName) requestBody.name = newName;

  const { data } = await drive.files.copy({
    fileId,
    requestBody,
    fields: 'id,name,webViewLink,mimeType',
    supportsAllDrives: true,
  });

  try {
    await drive.permissions.create({
      fileId: data.id,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    });
  } catch (permErr) {
    logger.warn(`Falha ao setar permissão anyone em ${data.id}: ${permErr.message}`);
  }
  return data;
}

/**
 * Extrai o fileId de URLs do Drive ou Docs.
 * Suporta formatos:
 *   - https://drive.google.com/file/d/FILE_ID/view
 *   - https://docs.google.com/document/d/FILE_ID/edit
 *   - https://drive.google.com/open?id=FILE_ID
 *   - FILE_ID puro
 */
/**
 * Busca o nome do arquivo no Drive pelo fileId.
 */
async function getDriveFileName(fileId, impersonatedEmail) {
  if (!fileId || !impersonatedEmail) return null;
  try {
    const drive = getDriveClientForUser(impersonatedEmail);
    const { data } = await drive.files.get({
      fileId,
      fields: 'id,name',
      supportsAllDrives: true,
    });
    return data?.name || null;
  } catch (err) {
    return null;
  }
}

/**
 * Extrai o título da reunião do nome do arquivo do Meet.
 * Ex: "1:1 Vinicius - 2026/04/16 15:00 GMT-03:00 - Notes by Gemini" → "1:1 Vinicius"
 */
function extractMeetingTitleFromFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') return null;
  let title = fileName;

  // Remover prefixo "Cópia de " (quando o arquivo é uma cópia)
  title = title.replace(/^Cópia de\s+/i, '').replace(/^Copy of\s+/i, '');

  // Remover sufixos de tipo de artefato
  title = title
    .replace(/\s*-\s*Anotações do Gemini\s*$/i, '')
    .replace(/\s*-\s*Anotações do Meet\s*$/i, '')
    .replace(/\s*-\s*Notes by Gemini\s*$/i, '')
    .replace(/\s*-\s*Notas do Meet\s*$/i, '')
    .replace(/\s*-\s*Transcrição\s*$/i, '')
    .replace(/\s*-\s*Transcription\s*$/i, '')
    .replace(/\s*-\s*Transcript\s*$/i, '')
    .replace(/\s*-\s*Gravação\s*$/i, '')
    .replace(/\s*-\s*Recording\s*$/i, '');

  // Remover timestamp no formato "YYYY/MM/DD HH:MM GMT..." ou similar
  title = title
    .replace(/\s*-\s*\d{4}[/-]\d{2}[/-]\d{2}\s+\d{1,2}:\d{2}.*$/i, '')
    .replace(/\s*\(\d{4}[/-]\d{2}[/-]\d{2}\).*$/i, '');

  // Reunião instantânea (padrão Meet): "Reunião iniciada às YYYY/MM/DD HH:MM..."
  if (/^Reunião iniciada às/i.test(title.trim())) {
    return null; // título genérico → usa o default "Reunião instantânea"
  }
  if (/^Meeting started at/i.test(title.trim())) return null;

  // Remover prefixos comuns
  title = title
    .replace(/^Anotações do Meet:\s*/i, '')
    .replace(/^Notes from\s+/i, '')
    .replace(/^Notas do Meet:\s*/i, '')
    .replace(/^Transcript of\s+/i, '')
    .replace(/^Transcrição de\s+/i, '')
    .replace(/^Gravação de\s+/i, '')
    .replace(/^Recording of\s+/i, '');

  const result = title.trim();
  if (!result || result === 'Reunião') return null;
  return result;
}

function extractFileIdFromDriveUrl(url) {
  if (!url) return null;
  if (!url.startsWith('http')) return url;

  const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (dMatch) return dMatch[1];

  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idMatch) return idMatch[1];

  const resourceKeyMatch = url.match(/\/document\/([a-zA-Z0-9_-]{10,})/);
  if (resourceKeyMatch) return resourceKeyMatch[1];

  return null;
}

module.exports = {
  getConferenceDetails,
  getRecording,
  getTranscript,
  getSmartNote,
  listConferenceRecordings,
  listConferenceTranscripts,
  listConferenceSmartNotes,
  getUserEmailFromDirectory,
  copyFileToSharedFolderAndGetLink,
  findFolderByName,
  createFolder,
  getOrCreateUserFolder,
  copyFileToFolder,
  extractFileIdFromDriveUrl,
  getDriveFileName,
  extractMeetingTitleFromFileName,
};

/**
 * Busca evento do Google Calendar do usuário que tem o meet_link informado.
 * Útil para obter o TÍTULO real da reunião como foi marcada.
 * @param {string} userEmail - impersonar este usuário
 * @param {string} meetLink - ex: "https://meet.google.com/abc-defg-hij"
 * @param {Date|null} hintDate - data aproximada para narrow (opcional)
 * @returns {Promise<{summary, start, end, organizer}|null>}
 */
async function findCalendarEventByMeetLink(userEmail, meetLink, hintDate = null) {
  if (!meetLink) return null;
  try {
    const auth = getAuthClientForUser(userEmail);
    const calendar = google.calendar({ version: 'v3', auth });

    // Busca em uma janela de ±7 dias da hintDate (ou últimos 90 dias se não tiver)
    const base = hintDate ? new Date(hintDate) : new Date();
    const days = hintDate ? 7 : 90;
    const timeMin = new Date(base.getTime() - days * 86400000).toISOString();
    const timeMax = new Date(base.getTime() + days * 86400000).toISOString();

    // Extrai o ID do meet link (parte após o último /)
    const linkIdMatch = meetLink.match(/meet\.google\.com\/([a-zA-Z0-9-]+)/);
    const linkId = linkIdMatch ? linkIdMatch[1] : null;

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults: 250,
      singleEvents: true,
      orderBy: 'startTime',
      q: linkId || undefined,
    });

    for (const event of data.items || []) {
      const eventMeetUri = event.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri;
      if (eventMeetUri === meetLink || (linkId && eventMeetUri?.includes(linkId))) {
        return {
          summary: event.summary || null,
          start: event.start?.dateTime || event.start?.date || null,
          end: event.end?.dateTime || event.end?.date || null,
          organizer: event.organizer?.email || null,
        };
      }
    }
    return null;
  } catch (error) {
    logger.warn(`[findCalendarEvent] falhou para ${userEmail}: ${error.message}`);
    return null;
  }
}
