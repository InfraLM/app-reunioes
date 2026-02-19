require("dotenv").config(); // Carrega .env da raiz se executado de lá
if (!process.env.GOOGLE_PRIVATE_KEY) {
    console.error("❌ ERRO: GOOGLE_PRIVATE_KEY não encontrada no .env!");
    process.exit(1);
}

const { google } = require("googleapis");
const config = require("../config");
const { getAuthClientForUser, getAuthClient } = require("../services/auth");
const logger = require("./logger");

async function debugSubscriber() {
    console.log("🔍 Iniciando Debug do Subscriber...");
    console.log(`📂 PWD: ${process.cwd()}`);

    // 1. Listar usuários como Admin
    console.log("\n1. Listando usuários (Admin)...");
    try {
        const adminAuth = getAuthClient();
        await adminAuth.authorize();
        const admin = google.admin({ version: "directory_v1", auth: adminAuth });
        const res = await admin.users.list({
            customer: "my_customer",
            maxResults: 1,
        });

        if (!res.data.users || res.data.users.length === 0) {
            console.error("❌ Nenhum usuário encontrado!");
            return;
        }

        const user = res.data.users[0];
        console.log(`✅ Usuário encontrado: ${user.primaryEmail} (ID: ${user.id})`);

        // 2. Impersonar Usuário
        console.log(`\n2. Impersonando ${user.primaryEmail}...`);
        const userAuth = getAuthClientForUser(user.primaryEmail);
        await userAuth.authorize();
        console.log("✅ Autenticado como usuário!");

        // 3. Testar Acesso ao Meet (PULADO)
        // O cliente Meet pode falhar dependendo da versão, vamos focar no Workspace Events
        console.log("\n3. Testando Acesso ao Meet (PULADO para focar na Assinatura)...");

        // 4. Testar Criação de Assinatura (Workspace Events)
        console.log("\n4. Testando Criação de Assinatura (Workspace Events)...");
        const workspaceEvents = google.workspaceevents("v1");

        // TENTATIVA A: Usando ID
        const targetResourceID = `//cloudidentity.googleapis.com/users/${user.id}`;
        console.log(`   Tentando com ID: ${targetResourceID}`);

        try {
            const response = await workspaceEvents.subscriptions.create({
                auth: userAuth,
                requestBody: {
                    target_resource: targetResourceID,
                    event_types: [
                        "google.workspace.meet.recording.v2.fileGenerated",
                    ],
                    notification_endpoint: {
                        pubsub_topic: `projects/${config.google.projectId}/topics/${config.pubsub.topicName}`,
                    },
                },
            });
            console.log("✅ Assinatura criada com SUCESSO (usando ID)!", response.data);

            // Cleanup
            console.log("🧹 Removendo assinatura de teste...");
            await workspaceEvents.subscriptions.delete({
                auth: userAuth,
                name: response.data.name,
            });
            console.log("✅ Assinatura removida.");

        } catch (subError) {
            console.error("❌ ERRO ao criar assinatura (usando ID):");
            console.error(`   Status: ${subError.code}`);
            console.error(`   Mensagem: ${subError.message}`);
            if (subError.response && subError.response.data && subError.response.data.error) {
                console.error("   Detalhes:", JSON.stringify(subError.response.data.error, null, 2));
            }

            // TENTATIVA B: Usando Email (como fallback/comparação)
            const targetResourceEmail = `//cloudidentity.googleapis.com/users/${user.primaryEmail}`;
            console.log(`\n   Tentando com Email: ${targetResourceEmail}`);
            try {
                const response = await workspaceEvents.subscriptions.create({
                    auth: userAuth,
                    requestBody: {
                        target_resource: targetResourceEmail,
                        event_types: [
                            "google.workspace.meet.recording.v2.fileGenerated",
                        ],
                        notification_endpoint: {
                            pubsub_topic: `projects/${config.google.projectId}/topics/${config.pubsub.topicName}`,
                        },
                    },
                });
                console.log("✅ Assinatura criada com SUCESSO (usando Email)!", response.data);
                // Cleanup...
                console.log("🧹 Removendo assinatura de teste (criada com Email)...");
                await workspaceEvents.subscriptions.delete({
                    auth: userAuth,
                    name: response.data.name,
                });
                console.log("✅ Assinatura removida.");
            } catch (emailError) {
                console.error("❌ ERRO ao criar assinatura (usando Email):");
                console.error(`   Mensagem: ${emailError.message}`);
                if (emailError.response && emailError.response.data && emailError.response.data.error) {
                    console.error("   Detalhes:", JSON.stringify(emailError.response.data.error, null, 2));
                }
            }
        }

    } catch (error) {
        console.error("❌ Erro fatal no script:", error);
    }
}

debugSubscriber();
