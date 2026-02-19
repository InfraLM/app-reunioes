const { google } = require("googleapis");
const config = require("../config");
const logger = require("../utils/logger");
const { getAuthClient, getAuthClientForUser } = require("./auth");
const { registerUser } = require("./userRegistry");

let subscriptionStats = {
    total: 0,
    successful: 0,
    failed: 0,
    deleted: 0
};

const workspaceEvents = google.workspaceevents("v1");

// Todos os tipos de eventos a monitorar
const EVENT_TYPES = [
    "google.workspace.meet.conference.v2.started",
    "google.workspace.meet.conference.v2.ended",
    "google.workspace.meet.recording.v2.fileGenerated",
    "google.workspace.meet.transcript.v2.fileGenerated",
    "google.workspace.meet.smartNote.v2.fileGenerated",
];

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

/**
 * Helper: delay em milissegundos
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Obtém userId a partir do email via Admin SDK
 */
async function getUserId(adminAuthClient, userEmail) {
    try {
        const admin = google.admin({ version: "directory_v1", auth: adminAuthClient });
        const res = await admin.users.get({ userKey: userEmail });
        logger.info(`[Admin SDK] ${userEmail} → ${res.data.id}`);
        return res.data.id;
    } catch (error) {
        logger.error(`Failed to get ID for user ${userEmail}: ${error.message}`);
        return null;
    }
}

// ============================================
// GERENCIAMENTO DE SUBSCRIPTIONS (Delete on Conflict)
// ============================================

/**
 * Tenta criar subscription, e se houver conflito (409), deleta a antiga e recria
 */
async function createWithRetry(userAuth, userId, userEmail) {
    const targetResource = `//cloudidentity.googleapis.com/users/${userId}`;
    const pubsubTopic = `projects/${config.google.projectId}/topics/${config.pubsub.topicName}`;

    const subscriptionPayload = {
        target_resource: targetResource,
        event_types: EVENT_TYPES,
        notification_endpoint: {
            pubsub_topic: pubsubTopic,
        },
    };

    try {
        logger.info(`[Create] Creating subscription for ${userEmail}...`);

        const response = await workspaceEvents.subscriptions.create({
            auth: userAuth,
            requestBody: subscriptionPayload,
        });

        const subId = response.data.name.split("/").pop();
        logger.info(`[Create] ✅ Subscription created for ${userEmail}: ${subId}`);
        subscriptionStats.successful++;
        return response.data;

    } catch (error) {
        // Verifica se o erro é "ALREADY_EXISTS" (409)
        if (error.code === 409 || error.response?.status === 409) {
            const details = error.response?.data?.error?.details;
            let existingSubName = null;

            // Extrai o nome da subscription conflitante dos detalhes do erro
            if (details && Array.isArray(details)) {
                const info = details.find(d => d.metadata && d.metadata.current_subscription);
                if (info) {
                    existingSubName = info.metadata.current_subscription;
                }
            }

            if (existingSubName) {
                logger.info(`[Conflict] Subscription already exists (${existingSubName}) for ${userEmail}. Deleting and retrying...`);

                try {
                    // Deleta a subscription conflitante
                    await workspaceEvents.subscriptions.delete({
                        auth: userAuth,
                        name: existingSubName
                    });

                    const subId = existingSubName.split("/").pop();
                    logger.info(`[Delete] ✅ Deleted conflicting subscription: ${subId}`);
                    subscriptionStats.deleted++;

                    // Tenta criar novamente
                    const retryResponse = await workspaceEvents.subscriptions.create({
                        auth: userAuth,
                        requestBody: subscriptionPayload,
                    });

                    const newSubId = retryResponse.data.name.split("/").pop();
                    logger.info(`[Create] ✅ Subscription created (retry) for ${userEmail}: ${newSubId}`);
                    subscriptionStats.successful++;
                    return retryResponse.data;

                } catch (retryErr) {
                    logger.error(`[Error] ❌ Failed to replace subscription for ${userEmail}: ${retryErr.message}`);
                    subscriptionStats.failed++;
                    throw retryErr;
                }
            } else {
                logger.warn(`[Warning] Received 409 for ${userEmail} but could not extract existing subscription name.`);
                subscriptionStats.failed++;
                throw error;
            }
        }

        // Outro tipo de erro
        logger.error(`[Create] ❌ Failed to create subscription for ${userEmail}: ${error.message}`);

        if (error.response?.data) {
            logger.error("[Create] Error details:", { details: error.response.data });
        }

        subscriptionStats.failed++;
        throw error;
    }
}

/**
 * Processa UM usuário completo
 */
async function processUser(adminAuth, userEmail, index, total) {
    logger.info(`\n${"=".repeat(70)}`);
    logger.info(`[${index}/${total}] Processing: ${userEmail}`);
    logger.info("=".repeat(70));

    try {
        // 1. Obter userId
        const userId = await getUserId(adminAuth, userEmail);
        if (!userId) {
            logger.warn(`[Skip] Could not get userId for ${userEmail}`);
            subscriptionStats.failed++;
            return false;
        }

        // 2. Registrar mapeamento userId → email
        registerUser(userId, userEmail);

        // 3. Criar autenticação impersonada
        const userAuth = getAuthClientForUser(userEmail);
        await userAuth.authorize();
        logger.info(`[Auth] ✅ User authentication successful for ${userEmail}`);

        // 4. Criar subscription (com retry automático em caso de conflito)
        await createWithRetry(userAuth, userId, userEmail);

        logger.info(`[Success] ✅ ${userEmail} processed successfully\n`);
        return true;

    } catch (error) {
        logger.error(`[Error] ❌ Failed to process ${userEmail}: ${error.message}`);
        return false;
    }
}

// ============================================
// FUNÇÃO PRINCIPAL DE INICIALIZAÇÃO
// ============================================

async function initializeSubscriptions() {
    subscriptionStats = {
        total: 0,
        successful: 0,
        failed: 0,
        deleted: 0
    };

    logger.info(`\n${"=".repeat(70)}`);
    logger.info("🚀 SUBSCRIPTION INITIALIZATION");
    logger.info("=".repeat(70));
    logger.info(`Users to process: ${config.usersToMonitor.length}`);
    logger.info(`Pub/Sub Topic: projects/${config.google.projectId}/topics/${config.pubsub.topicName}`);
    logger.info(`Strategy: DELETE ON CONFLICT (Automatic Retry)`);
    logger.info("=".repeat(70) + "\n");

    subscriptionStats.total = config.usersToMonitor.length;

    // 1. Criar cliente Admin SDK
    const adminAuth = getAuthClient();
    await adminAuth.authorize();
    logger.info("[Admin Auth] ✅ Admin authentication successful\n");

    // 2. Processar cada usuário sequencialmente com throttling
    for (let i = 0; i < config.usersToMonitor.length; i++) {
        const userEmail = config.usersToMonitor[i];

        await processUser(adminAuth, userEmail, i + 1, config.usersToMonitor.length);

        // Throttling: delay de 1 segundo entre usuários para evitar rate limit
        if (i < config.usersToMonitor.length - 1) {
            await delay(1000);
        }
    }

    // 3. Relatório final
    logger.info("\n" + "=".repeat(70));
    logger.info("📊 INITIALIZATION COMPLETE");
    logger.info("=".repeat(70));
    logger.info(`Total users:              ${subscriptionStats.total}`);
    logger.info(`✅ Successfully created:   ${subscriptionStats.successful}`);
    logger.info(`❌ Failed:                 ${subscriptionStats.failed}`);
    logger.info(`🗑️  Subscriptions deleted:  ${subscriptionStats.deleted}`);
    logger.info("=".repeat(70) + "\n");

    if (subscriptionStats.failed > 0) {
        logger.warn(`⚠️  WARNING: ${subscriptionStats.failed} user(s) failed. Check logs above.`);
    }

    // Permitir que o servidor continue mesmo se nenhuma foi criada (pode ser que todas já existissem e foram recriadas)
    if (subscriptionStats.successful === 0 && subscriptionStats.deleted === 0) {
        logger.error("❌ No subscriptions were created and none already existed! Check Google Workspace configuration.");
        throw new Error("No subscriptions available! Check logs for errors.");
    }

    if (subscriptionStats.successful === 0 && subscriptionStats.deleted > 0) {
        logger.info("ℹ️  No new subscriptions created, but existing ones were found and recreated. System will continue.\n");
    } else {
        logger.info("✅ Subscription initialization completed successfully!\n");
    }

    return subscriptionStats;
}

function getSubscriptionStats() {
    return subscriptionStats;
}

module.exports = { initializeSubscriptions, getSubscriptionStats };
