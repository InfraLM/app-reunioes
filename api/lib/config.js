// Lista de e-mails institucionais monitorados
// Pode ser configurada via variável de ambiente MONITORED_USERS (separados por vírgula)
// ou diretamente aqui como fallback
const usersToMonitor = process.env.MONITORED_USERS
  ? process.env.MONITORED_USERS.split(',').map((e) => e.trim()).filter(Boolean)
  : [];

module.exports = {
  google: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '')
      .replace(/^["']|["']$/g, '')   // Remove aspas no início e fim
      .replace(/\\n/g, '\n'),         // Converte \n literal para quebra de linha real
    impersonatedUser: process.env.IMPERSONATED_USER_EMAIL,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/meetings.space.readonly',
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
    ],
  },
  webhook: {
    destinationUrl: process.env.WEBHOOK_DESTINATION_URL,
  },
  usersToMonitor,
};
