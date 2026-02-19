const usersToMonitor = require("./users.json");

module.exports = {
  google: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || "")
      .replace(/^["']|["']$/g, "") // Remove aspas no início e fim
      .replace(/\\n/g, "\n"),      // Converte \n literal para quebra de linha real
    impersonatedUser: process.env.IMPERSONATED_USER_EMAIL,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/meetings.space.readonly",
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/admin.directory.user.readonly",
    ],
    userScopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/meetings.space.readonly",
    ],
  },
  pubsub: {
    topicName: process.env.PUBSUB_TOPIC_NAME,
    subscriptionName: process.env.PUBSUB_SUBSCRIPTION_NAME,
  },
  webhook: {
    destinationUrl: process.env.WEBHOOK_DESTINATION_URL,
  },
  app: {
    port: process.env.PORT || 4000,
  },
  usersToMonitor,
};
