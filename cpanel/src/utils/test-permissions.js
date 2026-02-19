require("dotenv").config();
const { google } = require("googleapis");
const config = require("../config");
const { getAuthClient } = require("../services/auth");
const logger = require("./logger");

async function testPermissions() {
    console.log("INICIANDO TESTE DE PERMISSOES...");
    console.log(`Usuario personificado: ${config.google.impersonatedUser}`);
    console.log(`Service Account: ${config.google.serviceAccountEmail}`);

    const auth = getAuthClient();

    try {
        console.log("\n1. Testando Autenticacao (JWT)...");
        await auth.authorize();
        console.log("OK: Autenticado com sucesso!");
    } catch (error) {
        console.error("ERRO: Falha na autenticacao:", error.message);
        return;
    }

    try {
        console.log("\n2. Testando acesso ao Diretorio (Admin SDK)...");
        const admin = google.admin({ version: "directory_v1", auth });
        const res = await admin.users.list({
            customer: "my_customer",
            maxResults: 1,
        });

        if (res.data.users && res.data.users.length > 0) {
            console.log(`OK: Sucesso! Usuario encontrado: ${res.data.users[0].primaryEmail}`);
        } else {
            console.log("OK: Sucesso! Acesso permitido, mas nenhum usuario retornado (lista vazia).");
        }

    } catch (error) {
        console.error("ERRO: Falha ao listar usuarios (Admin SDK):");
        console.error(`Detalhe do erro: ${error.message}`);
        console.error("VERIFICACAO: O escopo 'https://www.googleapis.com/auth/admin.directory.user.readonly' esta no Admin Console?");
    }

    console.log("\n---------------------------------------------------");
    console.log("FIM DO TESTE.");
}

testPermissions();
