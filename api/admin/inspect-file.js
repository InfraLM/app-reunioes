import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDriveFileName, extractMeetingTitleFromFileName, extractFileIdFromDriveUrl } = require('../lib/google');

/**
 * GET /api/admin/inspect-file?fileId=xxx&email=yyy
 * OR GET /api/admin/inspect-file?url=xxx&email=yyy
 */
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let { fileId, url, email } = req.query;
  if (url && !fileId) fileId = extractFileIdFromDriveUrl(url);
  if (!fileId || !email) return res.status(400).json({ error: 'fileId (ou url) e email obrigatórios' });

  try {
    const name = await getDriveFileName(fileId, email);
    const extracted = extractMeetingTitleFromFileName(name);
    return res.status(200).json({ fileId, fileName: name, extractedTitle: extracted });
  } catch (error) {
    return res.status(500).json({ error: error.message, stack: error.stack?.split('\n').slice(0, 5) });
  }
}
