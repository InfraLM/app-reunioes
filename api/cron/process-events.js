import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');
const {
  getConferenceDetails,
  getOrCreateUserFolder,
  findFolderByName,
  createFolder,
  copyFileToFolder,
  extractFileIdFromDriveUrl,
} = require('../lib/google');
const config = require('../lib/config');

const MAX_MEETS_PER_RUN = 5;

// Status finais (ciclo de vida pós-artefatos) que NÃO devem ser sobrescritos pelo worker
const STATUS_POS_ENVIO = new Set([
  'webhook_enfileirado',
  'webhook_enviando',
  'webhook_enviado',
  'webhook_erro',
  'ata_gerada',
  'ignorado',
]);

/**
 * POST/GET /api/cron/process-events
 *
 * Worker que lê epp_evento_track, agrega estado em epp_meet_process,
 * cria pasta no Drive, copia os artefatos e mantém epp_meet_status atualizado.
 *
 * **Não envia webhook automaticamente** — envio é manual via UI.
 */
export default async function handler(req, res) {
  const startTime = Date.now();
  logger.info('[worker] invocado', { method: req.method, hasBody: !!req.body });

  try {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      logger.warn('[worker] 401 — token inválido');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const specificId = req.body?.conference_id;
    const conferenceIds = specificId
      ? [specificId]
      : await findPendingConferenceIds(MAX_MEETS_PER_RUN);

    logger.info('[worker] meets a processar', { count: conferenceIds.length, ids: conferenceIds, specificId });

    if (!conferenceIds.length) {
      return res.status(200).json({ success: true, processed: 0, message: 'No pending meets' });
    }

    const results = [];
    for (const cid of conferenceIds) {
      logger.info(`[worker] >>> iniciando meet ${cid}`);
      try {
        const result = await processConference(cid);
        logger.info(`[worker] <<< meet ${cid} finalizada`, result);
        results.push({ conference_id: cid, ...result });
      } catch (err) {
        logger.error(`[worker] ERRO na meet ${cid}`, {
          error: err.message,
          name: err.name,
          code: err.code,
          stack: err.stack?.split('\n').slice(0, 10).join('\n'),
        });
        results.push({ conference_id: cid, status: 'error', error: err.message });
        await prisma.eppMeetProcess.update({
          where: { conference_id: cid },
          data: {
            status: 'error',
            error_message: err.message,
            updated_at: new Date(),
          },
        }).catch(() => {});
      }
    }

    logger.info(`[worker] concluído em ${Date.now() - startTime}ms`, { processed: results.length });
    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (error) {
    logger.error('[worker] ERRO FATAL', {
      message: error.message,
      name: error.name,
      stack: error.stack?.split('\n').slice(0, 10).join('\n'),
    });
    return res.status(500).json({ error: error.message });
  }
}

async function findPendingConferenceIds(limit) {
  // Meets em meet_process que ainda não completaram (status 'pending' ou 'processing')
  const pending = await prisma.eppMeetProcess.findMany({
    where: { status: { notIn: ['complete', 'error'] } },
    select: { conference_id: true },
    orderBy: { last_event_at: 'asc' },
    take: limit,
  });
  const existing = new Set(pending.map((p) => p.conference_id));

  const needed = limit - pending.length;
  if (needed > 0) {
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT e.conference_id
      FROM lovable.epp_evento_track e
      LEFT JOIN lovable.epp_meet_process mp ON mp.conference_id = e.conference_id
      WHERE e.is_monitored = true
        AND e.conference_id IS NOT NULL
        AND mp.conference_id IS NULL
      ORDER BY e.conference_id
      LIMIT ${needed}
    `;
    for (const r of rows) {
      if (!existing.has(r.conference_id)) existing.add(r.conference_id);
    }
  }
  return [...existing];
}

/**
 * Processa uma meet: agrega eventos → UPSERT meet_process → cria pasta Drive → copia artefatos → UPSERT meet_status.
 * NÃO envia webhook — isso é manual pela UI.
 */
async function processConference(conferenceId) {
  logger.info(`Processando conferência: ${conferenceId}`);

  const events = await prisma.eppEventoTrack.findMany({
    where: { conference_id: conferenceId, is_monitored: true },
    orderBy: { received_at: 'asc' },
  });
  if (!events.length) {
    return { status: 'skipped', reason: 'no monitored events' };
  }

  const aggregate = aggregateEvents(events);
  if (!aggregate.user_email) {
    logger.warn(`Meet ${conferenceId} sem user_email resolvido. Pulando.`);
    return { status: 'skipped', reason: 'no user_email' };
  }

  // 1. UPSERT meet_process
  const mp = await prisma.eppMeetProcess.upsert({
    where: { conference_id: conferenceId },
    update: {
      status: 'processing',
      user_email: aggregate.user_email,
      user_id: aggregate.user_id,
      meet_space_id: aggregate.meet_space_id,
      last_event_at: aggregate.last_event_at,
      has_recording: aggregate.has_recording,
      has_transcript: aggregate.has_transcript,
      has_smart_note: aggregate.has_smart_note,
      ...(aggregate.recording_original_link && { recording_original_link: aggregate.recording_original_link }),
      ...(aggregate.recording_resource_name && { recording_resource_name: aggregate.recording_resource_name }),
      ...(aggregate.transcript_original_link && { transcript_original_link: aggregate.transcript_original_link }),
      ...(aggregate.transcript_resource_name && { transcript_resource_name: aggregate.transcript_resource_name }),
      ...(aggregate.smart_note_original_link && { smart_note_original_link: aggregate.smart_note_original_link }),
      ...(aggregate.smart_note_resource_name && { smart_note_resource_name: aggregate.smart_note_resource_name }),
      updated_at: new Date(),
    },
    create: {
      conference_id: conferenceId,
      user_email: aggregate.user_email,
      user_id: aggregate.user_id,
      meet_space_id: aggregate.meet_space_id,
      status: 'processing',
      first_event_at: aggregate.first_event_at,
      last_event_at: aggregate.last_event_at,
      has_recording: aggregate.has_recording,
      has_transcript: aggregate.has_transcript,
      has_smart_note: aggregate.has_smart_note,
      recording_original_link: aggregate.recording_original_link,
      recording_resource_name: aggregate.recording_resource_name,
      transcript_original_link: aggregate.transcript_original_link,
      transcript_resource_name: aggregate.transcript_resource_name,
      smart_note_original_link: aggregate.smart_note_original_link,
      smart_note_resource_name: aggregate.smart_note_resource_name,
    },
  });

  // 2. Buscar metadados da reunião (só 1x)
  if (!mp.meeting_title || !mp.meeting_start_time) {
    try {
      const details = await getConferenceDetails(conferenceId, mp.user_email);
      await prisma.eppMeetProcess.update({
        where: { conference_id: conferenceId },
        data: {
          meeting_title: details?.space?.displayName || 'Reunião do Google Meet',
          meeting_start_time: details?.startTime ? new Date(details.startTime) : null,
          meeting_end_time: details?.endTime ? new Date(details.endTime) : null,
        },
      });
    } catch (err) {
      logger.warn(`Falha ao buscar detalhes da meet ${conferenceId}: ${err.message}`);
    }
  }

  // 3. Garantir pasta no Drive
  const current = await prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } });
  if (!current.drive_folder_id) {
    try {
      const rootFolder = config.google.sharedFolderId;
      if (!rootFolder) throw new Error('GOOGLE_SHARED_DRIVE_FOLDER_ID não configurado');

      const userFolder = await getOrCreateUserFolder(rootFolder, current.user_email, current.user_email);
      let meetFolder = await findFolderByName(userFolder.id, conferenceId, current.user_email);
      if (!meetFolder) {
        meetFolder = await createFolder(userFolder.id, conferenceId, current.user_email);
      }
      await prisma.eppMeetProcess.update({
        where: { conference_id: conferenceId },
        data: {
          drive_folder_id: meetFolder.id,
          drive_folder_link: meetFolder.webViewLink || null,
          drive_folder_created_at: new Date(),
          updated_at: new Date(),
        },
      });
      logger.info(`Pasta Drive criada/encontrada: ${meetFolder.id}`);
    } catch (err) {
      logger.error(`Falha ao criar pasta Drive para ${conferenceId}: ${err.message}`);
      await prisma.eppMeetProcess.update({
        where: { conference_id: conferenceId },
        data: { error_message: `folder: ${err.message}`, updated_at: new Date() },
      }).catch(() => {});
    }
  }

  // 4. Copiar artefatos que ainda não foram copiados
  const latest = await prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } });
  if (latest.drive_folder_id) {
    await tryCopyArtifact(latest, 'recording');
    await tryCopyArtifact(latest, 'transcript');
    await tryCopyArtifact(latest, 'smart_note');
  }

  // 5. Reler estado final e atualizar meet_status
  const final = await prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } });
  const allCopied =
    (!final.has_recording || !!final.recording_copied_at) &&
    (!final.has_transcript || !!final.transcript_copied_at) &&
    (!final.has_smart_note || !!final.smart_note_copied_at);
  const hasAll = final.has_recording && final.has_transcript && final.has_smart_note;
  const artefatosCompletos = hasAll && allCopied;

  // Marca meet_process como 'complete' ou 'pending' para continuidade
  await prisma.eppMeetProcess.update({
    where: { conference_id: conferenceId },
    data: {
      status: artefatosCompletos ? 'complete' : 'pending',
      updated_at: new Date(),
    },
  });

  // 6. UPSERT meet_status (respeitando statuses pós-envio)
  await syncMeetStatus(final, artefatosCompletos, aggregate);

  return {
    status: artefatosCompletos ? 'artefatos_completos' : 'artefatos_faltantes',
    has_all: hasAll,
    all_copied: allCopied,
  };
}

async function tryCopyArtifact(mp, kind) {
  const linkField = `${kind}_original_link`;
  const copiedField = `${kind}_copied_at`;
  const fileIdField = `${kind}_drive_file_id`;
  const driveLinkField = `${kind}_drive_link`;
  const errorField = `${kind}_error`;
  const hasField = `has_${kind}`;

  if (!mp[hasField] || mp[copiedField]) return;
  const link = mp[linkField];
  if (!link) return;

  const fileId = extractFileIdFromDriveUrl(link);
  if (!fileId) {
    await prisma.eppMeetProcess.update({
      where: { conference_id: mp.conference_id },
      data: { [errorField]: `Não foi possível extrair fileId de ${link}`, updated_at: new Date() },
    });
    return;
  }

  try {
    const copied = await copyFileToFolder(fileId, mp.drive_folder_id, null, mp.user_email);
    await prisma.eppMeetProcess.update({
      where: { conference_id: mp.conference_id },
      data: {
        [fileIdField]: copied.id,
        [driveLinkField]: copied.webViewLink || null,
        [copiedField]: new Date(),
        [errorField]: null,
        updated_at: new Date(),
      },
    });
    logger.info(`Copiado ${kind} para pasta: ${copied.id}`);
  } catch (err) {
    logger.error(`Falha ao copiar ${kind} ${fileId}: ${err.message}`);
    await prisma.eppMeetProcess.update({
      where: { conference_id: mp.conference_id },
      data: { [errorField]: err.message.slice(0, 2000), updated_at: new Date() },
    });
  }
}

/**
 * Sincroniza epp_meet_status com o estado atual, respeitando statuses pós-envio.
 */
async function syncMeetStatus(mp, artefatosCompletos, aggregate) {
  const existing = await prisma.eppMeetStatus.findUnique({
    where: { conference_id: mp.conference_id },
  });

  // Não mexer em status pós-envio
  if (existing && STATUS_POS_ENVIO.has(existing.status)) {
    // Mas ainda atualiza flags de artefatos e timestamps (sem mudar status)
    await prisma.eppMeetStatus.update({
      where: { conference_id: mp.conference_id },
      data: {
        has_recording: mp.has_recording,
        has_transcript: mp.has_transcript,
        has_smart_note: mp.has_smart_note,
        data_ultimo_artefato: aggregate.last_event_at,
        updated_at: new Date(),
      },
    });
    return;
  }

  const novoStatus = artefatosCompletos ? 'artefatos_completos' : 'artefatos_faltantes';
  const estaEntrandoEmCompletos = novoStatus === 'artefatos_completos'
    && (!existing || existing.status !== 'artefatos_completos');

  if (existing) {
    await prisma.eppMeetStatus.update({
      where: { conference_id: mp.conference_id },
      data: {
        status: novoStatus,
        user_email: mp.user_email,
        user_id: mp.user_id,
        meeting_title: mp.meeting_title,
        meet_space_id: mp.meet_space_id,
        meeting_start_time: mp.meeting_start_time,
        meeting_end_time: mp.meeting_end_time,
        has_recording: mp.has_recording,
        has_transcript: mp.has_transcript,
        has_smart_note: mp.has_smart_note,
        data_ultimo_artefato: aggregate.last_event_at,
        ...(estaEntrandoEmCompletos && { data_artefatos_completos: new Date() }),
        updated_at: new Date(),
      },
    });
  } else {
    await prisma.eppMeetStatus.create({
      data: {
        conference_id: mp.conference_id,
        status: novoStatus,
        user_email: mp.user_email,
        user_id: mp.user_id,
        meeting_title: mp.meeting_title,
        meet_space_id: mp.meet_space_id,
        meeting_start_time: mp.meeting_start_time,
        meeting_end_time: mp.meeting_end_time,
        has_recording: mp.has_recording,
        has_transcript: mp.has_transcript,
        has_smart_note: mp.has_smart_note,
        data_primeiro_artefato: aggregate.first_event_at,
        data_ultimo_artefato: aggregate.last_event_at,
        ...(artefatosCompletos && { data_artefatos_completos: new Date() }),
      },
    });
  }
}

function aggregateEvents(events) {
  const agg = {
    user_email: null,
    user_id: null,
    meet_space_id: null,
    first_event_at: events[0].received_at,
    last_event_at: events[events.length - 1].received_at,
    has_recording: false,
    has_transcript: false,
    has_smart_note: false,
    recording_original_link: null,
    recording_resource_name: null,
    transcript_original_link: null,
    transcript_resource_name: null,
    smart_note_original_link: null,
    smart_note_resource_name: null,
  };
  for (const e of events) {
    if (!agg.user_email && e.user_email) agg.user_email = e.user_email;
    if (!agg.user_id && e.user_id) agg.user_id = e.user_id;
    if (!agg.meet_space_id && e.meet_space_id) agg.meet_space_id = e.meet_space_id;
    if (e.event_type === 'recording') {
      agg.has_recording = true;
      if (e.link) agg.recording_original_link = e.link;
      if (e.resource_name) agg.recording_resource_name = e.resource_name;
    } else if (e.event_type === 'transcript') {
      agg.has_transcript = true;
      if (e.link) agg.transcript_original_link = e.link;
      if (e.resource_name) agg.transcript_resource_name = e.resource_name;
    } else if (e.event_type === 'smart_note') {
      agg.has_smart_note = true;
      if (e.link) agg.smart_note_original_link = e.link;
      if (e.resource_name) agg.smart_note_resource_name = e.resource_name;
    }
  }
  return agg;
}
