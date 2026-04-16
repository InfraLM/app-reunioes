const { google } = require('googleapis');
const logger = require('./logger');
const config = require('./config');

// ============================================================
// Google Workspace Events API (v1)
// Usa o SDK googleapis (não fetch manual) — mesmo padrão do projeto
// antigo que funcionava, inclusive com retry em 409 ALREADY_EXISTS.
// ============================================================

const workspaceEvents = google.workspaceevents('v1');

const MEET_EVENT_TYPES = [
  'google.workspace.meet.conference.v2.started',
  'google.workspace.meet.conference.v2.ended',
  'google.workspace.meet.recording.v2.fileGenerated',
  'google.workspace.meet.transcript.v2.fileGenerated',
  'google.workspace.meet.smartNote.v2.fileGenerated',
];

/**
 * Retorna cliente JWT impersonando um usuário via Domain-Wide Delegation.
 */
function getAuthForUser(userEmail) {
  return new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: config.google.scopes,
    subject: userEmail,
  });
}

/**
 * Cliente JWT impersonando o admin (Directory API lookup).
 */
function getAdminAuth() {
  return new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: config.google.scopes,
    subject: config.google.impersonatedUser,
  });
}

/**
 * Busca ID numérico do usuário no Cloud Identity pelo email. Retorna null se falhar.
 */
async function resolveUserIdByEmail(userEmail) {
  try {
    const auth = getAdminAuth();
    await auth.authorize();
    const admin = google.admin({ version: 'directory_v1', auth });
    const { data } = await admin.users.get({ userKey: userEmail });
    return data.id || null;
  } catch (error) {
    logger.warn('[ws-events] falha ao resolver userId', {
      userEmail,
      code: error.code,
      message: error.message,
    });
    return null;
  }
}

/**
 * Lista subscriptions de um usuário (target_resource apontando para ele) no topic configurado.
 */
async function listUserSubscriptions(userEmail, userId, topicPath) {
  const authClient = getAuthForUser(userEmail);
  await authClient.authorize();

  const targetResource = `//cloudidentity.googleapis.com/users/${userId}`;
  // Filtro REQUER pelo menos um event_type. Usar o primeiro da lista.
  const filter = `event_types:"${MEET_EVENT_TYPES[0]}" AND target_resource="${targetResource}"`;

  const results = [];
  let pageToken = undefined;
  do {
    const { data } = await workspaceEvents.subscriptions.list({
      auth: authClient,
      filter,
      pageSize: 50,
      pageToken,
    });
    for (const sub of data?.subscriptions || []) {
      if (sub.notificationEndpoint?.pubsubTopic === topicPath) {
        results.push(sub);
      }
    }
    pageToken = data?.nextPageToken || undefined;
  } while (pageToken);

  return results;
}

/**
 * Cria subscription com retry automático em 409 ALREADY_EXISTS.
 * Quando conflita, extrai o nome da subscription existente, deleta e tenta criar novamente.
 */
async function createUserSubscription(userEmail, userId, topicPath) {
  const authClient = getAuthForUser(userEmail);
  await authClient.authorize();

  const targetResource = `//cloudidentity.googleapis.com/users/${userId}`;

  const requestBody = {
    target_resource: targetResource,
    event_types: MEET_EVENT_TYPES,
    notification_endpoint: {
      pubsub_topic: topicPath,
    },
    // NOTA: intencionalmente SEM payload_options nem ttl — usar defaults da API.
  };

  try {
    const { data } = await workspaceEvents.subscriptions.create({
      auth: authClient,
      requestBody,
    });
    logger.info('[ws-events] subscription criada', { userEmail, name: data?.name });
    return data;
  } catch (error) {
    const status = error.code || error.response?.status;

    // 409 ALREADY_EXISTS — pegar nome da existente e deletar, depois recriar
    if (status === 409) {
      const details = error.response?.data?.error?.details;
      let existingName = null;
      if (Array.isArray(details)) {
        const info = details.find((d) => d.metadata && d.metadata.current_subscription);
        if (info) existingName = info.metadata.current_subscription;
      }

      if (existingName) {
        logger.info('[ws-events] conflito 409 detectado, deletando existente', {
          userEmail,
          existingName,
        });
        try {
          await workspaceEvents.subscriptions.delete({ auth: authClient, name: existingName });
          const retry = await workspaceEvents.subscriptions.create({
            auth: authClient,
            requestBody,
          });
          logger.info('[ws-events] subscription criada (retry após 409)', {
            userEmail,
            name: retry.data?.name,
          });
          return retry.data;
        } catch (retryErr) {
          logger.error('[ws-events] falha no retry após 409', {
            userEmail,
            error: retryErr.message,
            data: retryErr.response?.data,
          });
          const e = new Error(retryErr.message);
          e.status = retryErr.code || retryErr.response?.status || 500;
          e.data = retryErr.response?.data;
          throw e;
        }
      } else {
        logger.warn('[ws-events] 409 sem current_subscription em details', {
          userEmail,
          details,
        });
      }
    }

    logger.error('[ws-events] falha ao criar subscription', {
      userEmail,
      code: status,
      message: error.message,
      data: error.response?.data,
    });
    const e = new Error(error.message);
    e.status = status || 500;
    e.data = error.response?.data;
    throw e;
  }
}

/**
 * Deleta uma subscription pelo nome (impersonando o mesmo usuário que criou).
 */
async function deleteSubscription(subscriptionName, userEmail) {
  const authClient = getAuthForUser(userEmail);
  await authClient.authorize();

  try {
    await workspaceEvents.subscriptions.delete({
      auth: authClient,
      name: subscriptionName,
    });
    logger.info('[ws-events] subscription deletada', { userEmail, subscriptionName });
  } catch (error) {
    logger.error('[ws-events] falha ao deletar subscription', {
      userEmail,
      subscriptionName,
      code: error.code || error.response?.status,
      message: error.message,
      data: error.response?.data,
    });
    const e = new Error(error.message);
    e.status = error.code || error.response?.status || 500;
    e.data = error.response?.data;
    throw e;
  }
}

module.exports = {
  MEET_EVENT_TYPES,
  resolveUserIdByEmail,
  listUserSubscriptions,
  createUserSubscription,
  deleteSubscription,
};
