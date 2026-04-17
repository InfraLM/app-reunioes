import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const prisma = require('../../lib/prisma.cjs');

/**
 * POST /api/admin/set-title  body: { cid, title }
 * Forca update manual do meeting_title para testar se coluna funciona.
 */
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { cid, title } = req.body || {};
  if (!cid || !title) return res.status(400).json({ error: 'cid e title são obrigatórios' });

  try {
    // Update direto via Prisma
    const result = await prisma.eppMeetProcess.update({
      where: { conference_id: cid },
      data: { meeting_title: title, updated_at: new Date() },
    });
    return res.status(200).json({
      success: true,
      conference_id: cid,
      title_saved: result.meeting_title,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message, code: error.code, meta: error.meta });
  }
}
