import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const prisma = require('../lib/prisma.cjs');

/**
 * GET /api/check-conferences
 * Debug: status agregado de todas as meets + últimos eventos recebidos.
 */
export default async function handler(req, res) {
  try {
    const [meets, recentEvents] = await Promise.all([
      prisma.eppMeetProcess.findMany({ orderBy: { last_event_at: 'desc' }, take: 200 }),
      prisma.eppEventoTrack.findMany({
        orderBy: { received_at: 'desc' },
        take: 50,
        select: {
          id: true,
          conference_id: true,
          event_type: true,
          event_category: true,
          user_email: true,
          is_monitored: true,
          received_at: true,
          link: true,
          resource_name: true,
          raw_payload: true,
        },
      }),
    ]);

    const grouped = meets.reduce((acc, m) => {
      acc[m.status] = acc[m.status] || [];
      acc[m.status].push({
        conference_id: m.conference_id,
        user_email: m.user_email,
        status: m.status,
        has_recording: m.has_recording,
        has_transcript: m.has_transcript,
        has_smart_note: m.has_smart_note,
        drive_folder_link: m.drive_folder_link,
        recording_drive_link: m.recording_drive_link,
        transcript_drive_link: m.transcript_drive_link,
        smart_note_drive_link: m.smart_note_drive_link,
        first_event_at: m.first_event_at,
        last_event_at: m.last_event_at,
      });
      return acc;
    }, {});

    return res.status(200).json({
      total_meets: meets.length,
      by_status: Object.keys(grouped).reduce((acc, status) => {
        acc[status] = grouped[status].length;
        return acc;
      }, {}),
      meets: grouped,
      recent_events: recentEvents.map((e) => ({
        ...e,
        id: e.id.toString(), // BigInt → string para JSON
      })),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack,
    });
  }
}
