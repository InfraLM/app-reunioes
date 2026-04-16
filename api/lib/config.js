// Lista de e-mails institucionais monitorados
// Configurada via MONITORED_USERS (separados por vírgula)
const usersToMonitor = process.env.MONITORED_USERS
  ? process.env.MONITORED_USERS.split(',').map((e) => e.trim()).filter(Boolean)
  : [];

module.exports = {
  google: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '')
      .replace(/^["']|["']$/g, '')
      .replace(/\\n/g, '\n'),
    impersonatedUser: process.env.IMPERSONATED_USER_EMAIL,
    sharedFolderId: process.env.GOOGLE_SHARED_DRIVE_FOLDER_ID,
    scopes: [
      'https://www.googleapis.com/auth/drive',                             // write scope — necessário para criar pasta e copiar arquivo
      'https://www.googleapis.com/auth/meetings.space.readonly',
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
    ],
  },
  webhook: {
    destinationUrl: process.env.WEBHOOK_DESTINATION_URL,
  },
  pubsub: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    topicName: process.env.PUBSUB_TOPIC_NAME,
    fullTopicPath: (process.env.GOOGLE_PROJECT_ID && process.env.PUBSUB_TOPIC_NAME)
      ? `projects/${process.env.GOOGLE_PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC_NAME}`
      : null,
  },
  usersToMonitor,
};
