const mapping = {};

/**
 * Registra o mapeamento de ID do usuário para Email
 */
function registerUser(userId, userEmail) {
    mapping[userId] = userEmail;
}

/**
 * Retorna o email do usuário dado o ID (formato //cloudidentity.googleapis.com/users/...)
 */
function getUserEmail(subject) {
    if (!subject) return null;
    const match = subject.match(/users\/(\d+)/);
    const userId = match ? match[1] : subject;
    return mapping[userId] || null;
}

module.exports = { registerUser, getUserEmail };
