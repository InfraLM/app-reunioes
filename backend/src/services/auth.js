const { google } = require("googleapis");
const config = require("../config");

let jwtClient;

function getAuthClient() {
    if (jwtClient) {
        return jwtClient;
    }

    jwtClient = new google.auth.JWT({
        email: config.google.serviceAccountEmail,
        key: config.google.privateKey,
        scopes: config.google.scopes,
        subject: config.google.impersonatedUser
    });

    return jwtClient;
}

function getAuthClientForUser(userEmail) {
    return new google.auth.JWT({
        email: config.google.serviceAccountEmail,
        key: config.google.privateKey,
        scopes: config.google.userScopes,
        subject: userEmail
    });
}

async function authorize() {
    const client = getAuthClient();
    await client.authorize();
    return client;
}

module.exports = { authorize, getAuthClient, getAuthClientForUser };
