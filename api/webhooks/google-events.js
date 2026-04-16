import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');
const { getUserEmailFromDirectory } = require('../lib/google');
const config = require('../lib/config');

/**
 * POST /api/webhooks/google-events
 *
 * Responsabilidade única: registrar o evento bruto em epp_evento_track e responder 2xx.
 * Todo processamento (UPSERT em meet_process, cópias de artefato, webhook final) é
 * feito de forma assíncrona pelo worker /api/cron/process-events.
 *
 * Também dispara um wakeup opcional no worker via QStash (delay curto).
 */

/** Tipos derivados a partir do ce-type do CloudEvent. */
function classifyEvent(ceType) {
  if (!ceType) return { event_type: 'unknown', event_category: 'other' };
  const t = ceType.toLowerCase();
  if (t.includes('recording')) return { event_type: 'recording', event_category: 'artifact' };
  if (t.includes('transcript')) return { event_type: 'transcript', event_category: 'artifact' };
  if (t.includes('smartnote') || t.includes('smart_note')) return { event_type: 'smart_note', event_category: 'artifact' };
  if (t.includes('conference') && t.includes('started')) return { event_type: 'started', event_category: 'lifecycle' };
  if (t.includes('conference') && t.includes('ended')) return { event_type: 'ended', event_category: 'lifecycle' };
  if (t.includes('participant')) return { event_type: 'participant_join', event_category: 'participant' };
  return { event_type: 'unknown', event_category: 'other' };
}

function getConferenceIdFromPayload(payload) {
  if (payload.conferenceRecord?.name) return payload.conferenceRecord.name;
  const artifactName = payload.recording?.name || payload.transcript?.name || payload.smartNote?.name;
  if (artifactName) {
    const match = artifactName.match(/^(conferenceRecords\/[^/]+)/);
    if (match) return match[1];
  }
  return null;
}

function getMeetSpaceIdFromPayload(payload) {
  return payload.conferenceRecord?.space
    || payload.space?.name
    || null;
}

function getResourceDetails(payload, eventType) {
  if (eventType === 'recording' && payload.recording) {
    const link = payload.recording.driveDestination?.exportUri || null;
    return { link, resource_name: payload.recording.name || null };
  }
  if (eventType === 'transcript' && payload.transcript) {
    const link = payload.transcript.docsDestination?.exportUri
      || (payload.transcript.docsDestination?.document
        ? `https://docs.google.com/document/d/${payload.transcript.docsDestination.document}/edit`
        : null);
    return { link, resource_name: payload.transcript.name || null };
  }
  if (eventType === 'smart_note' && payload.smartNote) {
    const link = payload.smartNote.docsDestination?.exportUri
      || (payload.smartNote.docsDestination?.document
        ? `https://docs.google.com/document/d/${payload.smartNote.docsDestination.document}/view`
        : null);
    return { link, resource_name: payload.smartNote.name || null };
  }
  return { link: null, resource_name: null };
}

/** Extrai o ID numérico do usuário do ce-subject. */
function extractUserIdFromSubject(subject) {
  if (!subject) return null;
  const match = subject.match(/users\/(\d+)|\/(\d+)$/);
  return match ? (match[1] || match[2]) : null;
}

/**
 * Acorda o worker de processamento via QStash (delay curto).
 * Se QStash não estiver configurado, apenas loga.
 */
async function wakeProcessWorker() {
  const qstashToken = process.env.QSTASH_TOKEN;
  const appUrl = process.env.APP_URL;
  if (!qstashToken || !appUrl) return;

  const targetUrl = `${appUrl}/api/cron/process-events`;
  try {
    await fetch('https://qstash.upstash.io/v2/publish/' + encodeURIComponent(targetUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': '30s',
        'Upstash-Forward-Authorization': `Bearer ${process.env.CRON_SECRET || ''}`,
      },
      body: JSON.stringify({ trigger: 'event_received' }),
    });
  } catch (error) {
    logger.warn('Falha ao acordar worker via QStash', { error: error.message });
  }
}

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log('[webhook] POST recebido', req.method);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { message } = req.body || {};
    if (!message) {
      console.log('[webhook] body sem { message }', JSON.stringify(req.body).slice(0, 300));
      return res.status(200).send('Ignored: invalid format');
    }

    // Parse do CloudEvent
    const attributes = message.attributes || {};
    const ceType = attributes['ce-type'] || null;
    const ceSubject = attributes['ce-subject'] || null;
    const ceTime = attributes['ce-time'] || null;
    const pubsubMessageId = message.messageId || message.message_id || null;

    console.log('[webhook] CloudEvent:', ceType, ceSubject, pubsubMessageId);

    let rawPayload = null;
    try {
      rawPayload = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    } catch (e) {
      logger.warn('[webhook] falha ao decodificar data base64', { error: e.message });
    }

    const { event_type, event_category } = classifyEvent(ceType);
    const conferenceId = rawPayload ? getConferenceIdFromPayload(rawPayload) : null;
    const meetSpaceId = rawPayload ? getMeetSpaceIdFromPayload(rawPayload) : null;
    const userId = extractUserIdFromSubject(ceSubject);
    const { link, resource_name } = rawPayload
      ? getResourceDetails(rawPayload, event_type)
      : { link: null, resource_name: null };

    console.log('[webhook] tipo:', event_type, 'conf:', conferenceId, 'userId:', userId);

    // Resolver e-mail via Admin SDK (não bloqueia se falhar)
    let userEmail = null;
    if (ceSubject) {
      try {
        userEmail = await getUserEmailFromDirectory(ceSubject);
        console.log('[webhook] email resolvido:', userEmail);
      } catch (e) {
        console.error('[webhook] falha email:', ceSubject, e.message);
      }
    }

    const isMonitored = !!userEmail && config.usersToMonitor.includes(userEmail);
    console.log('[webhook] monitored:', isMonitored, 'email:', userEmail, 'total:', config.usersToMonitor.length);
    try {
      await prisma.eppEventoTrack.create({
        data: {
          pubsub_message_id: pubsubMessageId,
          ce_type: ceType || 'unknown',
          ce_subject: ceSubject,
          event_type,
          event_category,
          conference_id: conferenceId,
          meet_space_id: meetSpaceId,
          user_id: userId,
          user_email: userEmail,
          link,
          resource_name,
          is_monitored: isMonitored,
          event_timestamp: ceTime ? new Date(ceTime) : null,
          raw_payload: rawPayload,
          attributes,
        },
      });
      console.log('[webhook] ✅ INSERT OK', conferenceId, event_type, userEmail);
    } catch (dbErr) {
      if (dbErr.code === 'P2002') {
        console.log('[webhook] duplicado ignorado', pubsubMessageId);
      } else {
        console.error('[webhook] ❌ ERRO INSERT:', dbErr.code, dbErr.message, JSON.stringify(dbErr.meta || {}));
      }
    }

    if (isMonitored && conferenceId) {
      console.log('[webhook] wake worker QStash');
      wakeProcessWorker().catch((e) => console.warn('[webhook] wake falhou', e.message));
    }

    console.log(`[webhook] done ${Date.now() - startTime}ms`);
    return res.status(200).send('ok');
  } catch (error) {
    console.error('[webhook] FATAL:', error.message, error.stack?.split('\n').slice(0, 5).join('\n'));
    return res.status(200).json({ error: 'handled', message: error.message });
  }
}
