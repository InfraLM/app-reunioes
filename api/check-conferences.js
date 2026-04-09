import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const prisma = require('../lib/prisma.cjs');

/**
 * GET /api/check-conferences
 * Debug: Verificar status de todas as conferências
 */
export default async function handler(req, res) {
  try {
    const allConferences = await prisma.conferenceArtifactTracking.findMany({
      orderBy: {
        created_at: 'desc'
      }
    });

    const grouped = allConferences.reduce((acc, conf) => {
      acc[conf.status] = acc[conf.status] || [];
      acc[conf.status].push({
        conference_id: conf.conference_id,
        user_email: conf.user_email,
        status: conf.status,
        has_recording: conf.has_recording,
        has_transcript: conf.has_transcript,
        has_smart_note: conf.has_smart_note,
        timeout_at: conf.timeout_at,
        timeout_passed: new Date(conf.timeout_at) < new Date(),
        first_event_at: conf.first_event_at,
        created_at: conf.created_at
      });
      return acc;
    }, {});

    return res.status(200).json({
      total: allConferences.length,
      by_status: Object.keys(grouped).reduce((acc, status) => {
        acc[status] = grouped[status].length;
        return acc;
      }, {}),
      details: grouped
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}
