import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');
const {
  getConferenceDetails,
  getRecording,
  getTranscript,
  getSmartNote,
  listConferenceSmartNotes,
  findFolderByName,
  createFolder,
  extractFileIdFromDriveUrl,
  extractFolderIdFromDriveUrl,
  getDriveFileName,
  extractMeetingTitleFromFileName,
  listFilesInFolder,
  classifyDriveFile,
} = require('../lib/google');
const config = require('../lib/config');
const { syncMeetStatus, STATUS_POS_ENVIO } = require('../lib/meet-status');

const MAX_MEETS_PER_RUN = 5;

/**
 * Converte email em nome de pasta no Drive.
 * yuri.ribeiro@liberdademedicaedu.com.br → "Yuri Ribeiro"
 * infra@liberdademedicaedu.com.br → "Infra"
 */
function emailToFolderName(email) {
  const local = email.includes('@') ? email.split('@')[0] : email;
  return local
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

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
    const isVercelCron = !!req.headers['x-vercel-cron'];
    if (
      process.env.CRON_SECRET
      && !isVercelCron
      && authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
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
      console.log(`[worker] >>> iniciando meet ${cid}`);
      try {
        const result = await processConference(cid);
        console.log(`[worker] <<< meet ${cid} finalizada`, JSON.stringify(result));
        results.push({ conference_id: cid, ...result });
      } catch (err) {
        console.error(`[worker] ❌ ERRO na meet ${cid}: ${err.message}`);
        console.error(`  name: ${err.name} | code: ${err.code}`);
        console.error(`  stack: ${err.stack?.split('\n').slice(0, 8).join(' | ')}`);
        results.push({ conference_id: cid, status: 'error', error: err.message });
        await prisma.eppMeetProcess.update({
          where: { conference_id: cid },
          data: {
            status: 'error',
            updated_at: new Date(),
          },
        }).catch((e) => console.warn(`[worker] falha ao marcar erro: ${e.message}`));
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
  console.log(`[worker] step 2: metadados meet ${conferenceId.slice(-20)}`);
  if (!mp.meeting_title || mp.meeting_title === 'Reunião do Google Meet' || mp.meeting_title === 'Reunião instantânea' || !mp.meeting_start_time) {
    try {
      const details = await getConferenceDetails(conferenceId, mp.user_email);
      const title = details?.space?.displayName || null;
      const startTime = details?.startTime ? new Date(details.startTime) : null;
      const endTime = details?.endTime ? new Date(details.endTime) : null;

      await prisma.eppMeetProcess.update({
        where: { conference_id: conferenceId },
        data: {
          ...(title && { meeting_title: title }),
          ...(startTime && { meeting_start_time: startTime }),
          ...(endTime && { meeting_end_time: endTime }),
        },
      });
      console.log(`[worker] step 2 OK — title: ${title || 'null'}, start: ${startTime || 'null'}`);
    } catch (err) {
      console.error(`[worker] step 2 falhou: ${err.message}`);
    }
  }

  // 2b. Resolver URLs dos artefatos via Meet API (Pub/Sub só envia resource_name, não o link)
  console.log(`[worker] step 2b: resolveArtifactUrls`);
  await resolveArtifactUrls(conferenceId, mp.user_email);
  console.log(`[worker] step 2b OK`);

  // 2c. Se ainda não tem título, buscar do nome do arquivo (transcript/smart_note) no Drive
  try {
    const afterUrls = await prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } });
    console.log(`[worker] step 2c: current title="${afterUrls?.meeting_title || 'null'}"`);
    const needsTitle = !afterUrls.meeting_title || afterUrls.meeting_title === 'Reunião do Google Meet' || afterUrls.meeting_title === 'Reunião instantânea';
    if (needsTitle) {
      let titleFromFile = null;
      const candidates = [
        ['transcript', afterUrls.transcript_original_link],
        ['smart_note', afterUrls.smart_note_original_link],
        ['recording', afterUrls.recording_original_link],
      ];
      for (const [kind, link] of candidates) {
        if (!link) { console.log(`[worker] 2c: sem ${kind} link`); continue; }
        const fileId = extractFileIdFromDriveUrl(link);
        console.log(`[worker] 2c: ${kind} fileId=${fileId}`);
        if (!fileId) continue;
        const fileName = await getDriveFileName(fileId, afterUrls.user_email);
        console.log(`[worker] 2c: ${kind} fileName="${fileName}"`);
        const extracted = extractMeetingTitleFromFileName(fileName);
        console.log(`[worker] 2c: ${kind} extracted="${extracted}"`);
        if (extracted) { titleFromFile = extracted; break; }
      }

      const finalTitle = titleFromFile || 'Reunião instantânea';
      console.log(`[worker] 2c: ATUALIZANDO title para "${finalTitle}"`);
      await prisma.eppMeetProcess.update({
        where: { conference_id: conferenceId },
        data: { meeting_title: finalTitle, updated_at: new Date() },
      });
      console.log(`[worker] 2c: UPDATE concluído`);
    }
  } catch (e) {
    console.error(`[worker] step 2c falhou: ${e.message}`);
    console.error(`  stack: ${e.stack?.split('\n').slice(0, 5).join(' | ')}`);
  }

  // 3. Garantir pasta no Drive — usa pasta_destino configurada pelo admin em epp_user_pastas
  const current = await prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } });
  if (!current.drive_folder_id) {
    try {
      // Busca pasta_destino do usuário no banco
      const userPasta = await prisma.eppUserPastas.findUnique({
        where: { user_email: current.user_email },
      });
      console.log(`[worker] step 3: user_pasta para ${current.user_email}:`, JSON.stringify(userPasta || {}));

      const pastaDestinoId = userPasta?.pasta_destino
        ? extractFolderIdFromDriveUrl(userPasta.pasta_destino)
        : null;

      if (!pastaDestinoId) {
        console.warn(`[worker] pasta_destino não configurada para ${current.user_email} — pulando cópia`);
      } else {
        console.log(`[worker] pasta_destino ID: ${pastaDestinoId}`);
        // Cria (ou acha) subpasta da reunião dentro da pasta_destino
        let meetFolder = await findFolderByName(pastaDestinoId, conferenceId, current.user_email);
        if (!meetFolder) {
          meetFolder = await createFolder(pastaDestinoId, conferenceId, current.user_email);
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
        console.log(`[worker] Pasta Drive OK: ${meetFolder.id}`);
      }
    } catch (err) {
      console.error(`[worker] folder error: ${err.message}`);
      console.error(`  stack: ${err.stack?.split('\n').slice(0, 5).join(' | ')}`);
    }
  }

  // 4. Descobrir artefatos já presentes na subpasta (Drive é a fonte da verdade).
  //    Admin/Meet deposita os arquivos direto; worker só lê e popula links.
  const latest = await prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } });
  if (latest.drive_folder_id) {
    await discoverArtifactsInFolder(latest);
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

/**
 * Resolve URLs dos artefatos via Meet API.
 * O Pub/Sub só envia o resource_name (ex: conferenceRecords/.../recordings/xxx).
 * Precisamos chamar getRecording/getTranscript/getSmartNote para obter o link real.
 */
async function resolveArtifactUrls(conferenceId, userEmail) {
  const mp = await prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } });
  if (!mp) return;

  // Se meet_process não tem resource_name, buscar direto do evento_track (raw_payload)
  if (mp.has_recording && !mp.recording_resource_name) {
    const evt = await prisma.eppEventoTrack.findFirst({
      where: { conference_id: conferenceId, event_type: 'recording' },
      select: { resource_name: true, raw_payload: true },
    });
    const name = evt?.resource_name || evt?.raw_payload?.recording?.name;
    if (name) {
      await prisma.eppMeetProcess.update({ where: { conference_id: conferenceId }, data: { recording_resource_name: name } });
      mp.recording_resource_name = name;
      console.log(`[worker] backfill rec_name: ${name.slice(-40)}`);
    }
  }
  if (mp.has_transcript && !mp.transcript_resource_name) {
    const evt = await prisma.eppEventoTrack.findFirst({
      where: { conference_id: conferenceId, event_type: 'transcript' },
      select: { resource_name: true, raw_payload: true },
    });
    const name = evt?.resource_name || evt?.raw_payload?.transcript?.name;
    if (name) {
      await prisma.eppMeetProcess.update({ where: { conference_id: conferenceId }, data: { transcript_resource_name: name } });
      mp.transcript_resource_name = name;
      console.log(`[worker] backfill trs_name: ${name.slice(-40)}`);
    }
  }
  if (mp.has_smart_note && !mp.smart_note_resource_name) {
    const evt = await prisma.eppEventoTrack.findFirst({
      where: { conference_id: conferenceId, event_type: 'smart_note' },
      select: { resource_name: true, raw_payload: true, is_monitored: true },
    });
    console.log(`[worker] sn event found: ${!!evt}, monitored: ${evt?.is_monitored}, res: ${evt?.resource_name?.slice(-30)||'null'}`);
    const name = evt?.resource_name || evt?.raw_payload?.smartNote?.name;
    if (name) {
      await prisma.eppMeetProcess.update({ where: { conference_id: conferenceId }, data: { smart_note_resource_name: name } });
      mp.smart_note_resource_name = name;
      console.log(`[worker] backfill sn_name: ${name.slice(-40)}`);
    }
  }

  const updates = {};

  // Recording
  if (mp.has_recording && !mp.recording_original_link && mp.recording_resource_name) {
    try {
      const rec = await getRecording(mp.recording_resource_name, userEmail);
      const url = rec?.driveDestination?.exportUri
        || (rec?.driveDestination?.file ? `https://drive.google.com/file/d/${rec.driveDestination.file}/view` : null);
      if (url) {
        updates.recording_original_link = url;
        console.log(`[worker] recording URL resolvida: ${url}`);
      }
    } catch (err) {
      console.log(`[worker] falha ao resolver recording ${mp.recording_resource_name}: ${err.message}`);
    }
  }

  // Transcript
  if (mp.has_transcript && !mp.transcript_original_link && mp.transcript_resource_name) {
    try {
      const tr = await getTranscript(mp.transcript_resource_name, userEmail);
      const url = tr?.docsDestination?.exportUri
        || (tr?.docsDestination?.document ? `https://docs.google.com/document/d/${tr.docsDestination.document}/edit` : null);
      if (url) {
        updates.transcript_original_link = url;
        console.log(`[worker] transcript URL resolvida: ${url}`);
      }
    } catch (err) {
      console.log(`[worker] falha ao resolver transcript ${mp.transcript_resource_name}: ${err.message}`);
    }
  }

  // Smart Note — v2beta pode não retornar docsDestination, então tenta getSmartNote + fallback listConferenceSmartNotes
  if (mp.has_smart_note && !mp.smart_note_original_link) {
    let snUrl = null;

    // Tentativa 1: getSmartNote direto (v2beta)
    if (mp.smart_note_resource_name) {
      try {
        const sn = await getSmartNote(mp.smart_note_resource_name, userEmail);
        console.log(`[worker] getSmartNote response:`, JSON.stringify(sn).slice(0, 500));
        snUrl = sn?.docsDestination?.exportUri
          || (sn?.docsDestination?.document ? `https://docs.google.com/document/d/${sn.docsDestination.document}/view` : null);
      } catch (err) {
        console.log(`[worker] getSmartNote falhou: ${err.message}`);
      }
    }

    // Tentativa 2: listConferenceSmartNotes (lista todas do conference e pega a primeira com URL)
    if (!snUrl) {
      try {
        const confId = conferenceId;
        const smartNotes = await listConferenceSmartNotes(confId, userEmail);
        console.log(`[worker] listSmartNotes retornou ${smartNotes?.length || 0} items`);
        for (const sn of (smartNotes || [])) {
          console.log(`[worker] smartNote item:`, JSON.stringify(sn).slice(0, 500));
          const url = sn?.docsDestination?.exportUri
            || (sn?.docsDestination?.document ? `https://docs.google.com/document/d/${sn.docsDestination.document}/view` : null);
          if (url) { snUrl = url; break; }
        }
      } catch (err) {
        console.log(`[worker] listSmartNotes falhou: ${err.message}`);
      }
    }

    if (snUrl) {
      updates.smart_note_original_link = snUrl;
      console.log(`[worker] smart_note URL resolvida: ${snUrl}`);
    } else {
      console.log(`[worker] smart_note: nenhuma URL encontrada para ${conferenceId}`);
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.eppMeetProcess.update({
      where: { conference_id: conferenceId },
      data: { ...updates, updated_at: new Date() },
    });
    console.log(`[worker] ${Object.keys(updates).length} URLs resolvidas para ${conferenceId}`);
  }
}

/**
 * Lista arquivos da subpasta `drive_folder_id` e classifica cada um como
 * recording / transcript / smart_note. Popula os campos *_drive_file_id,
 * *_drive_link, *_copied_at e has_* com base nos arquivos encontrados.
 * Não copia nada — assume que admin ou Meet já depositou os arquivos.
 */
async function discoverArtifactsInFolder(mp) {
  let files;
  try {
    files = await listFilesInFolder(mp.drive_folder_id, mp.user_email);
  } catch (err) {
    console.error(`[worker] falha ao listar arquivos em ${mp.drive_folder_id}: ${err.message}`);
    return;
  }

  console.log(`[worker] discover: ${files.length} arquivo(s) em ${mp.drive_folder_id}`);

  const byKind = { recording: null, transcript: null, smart_note: null };
  for (const f of files) {
    const kind = classifyDriveFile({ name: f.name, mimeType: f.mimeType });
    if (!kind) continue;
    const current = byKind[kind];
    const fCreated = f.createdTime ? new Date(f.createdTime).getTime() : 0;
    const cCreated = current?.createdTime ? new Date(current.createdTime).getTime() : Infinity;
    if (!current || fCreated < cCreated) byKind[kind] = f;
  }

  const updates = { updated_at: new Date() };
  for (const kind of ['recording', 'transcript', 'smart_note']) {
    const f = byKind[kind];
    if (!f) continue;
    updates[`${kind}_drive_file_id`] = f.id;
    updates[`${kind}_drive_link`] = f.webViewLink || null;
    updates[`${kind}_copied_at`] = f.createdTime ? new Date(f.createdTime) : new Date();
    updates[`has_${kind}`] = true;
    updates[`${kind}_error`] = null;
  }

  if (Object.keys(updates).length > 1) {
    await prisma.eppMeetProcess.update({
      where: { conference_id: mp.conference_id },
      data: updates,
    });
    console.log(`[worker] discover OK: rec=${!!byKind.recording} trs=${!!byKind.transcript} sn=${!!byKind.smart_note}`);
  }
}

/**
 * Extrai resource_name do raw_payload JSONB quando o campo resource_name está null.
 * O Pub/Sub envia: { recording: { name: "..." } } ou { transcript: { name: "..." } } etc.
 */
function extractResourceFromPayload(rawPayload, eventType) {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  if (eventType === 'recording') return rawPayload.recording?.name || null;
  if (eventType === 'transcript') return rawPayload.transcript?.name || null;
  if (eventType === 'smart_note') return rawPayload.smartNote?.name || null;
  return null;
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

    // Tenta resource_name do campo direto, fallback: extrai do raw_payload
    const resName = e.resource_name || extractResourceFromPayload(e.raw_payload, e.event_type);

    if (e.event_type === 'recording') {
      agg.has_recording = true;
      if (e.link) agg.recording_original_link = e.link;
      if (resName) agg.recording_resource_name = resName;
    } else if (e.event_type === 'transcript') {
      agg.has_transcript = true;
      if (e.link) agg.transcript_original_link = e.link;
      if (resName) agg.transcript_resource_name = resName;
    } else if (e.event_type === 'smart_note') {
      agg.has_smart_note = true;
      if (e.link) agg.smart_note_original_link = e.link;
      if (resName) agg.smart_note_resource_name = resName;
    }
  }
  console.log('[worker] aggregate result:', JSON.stringify({
    rec_res: agg.recording_resource_name?.slice(-30),
    trs_res: agg.transcript_resource_name?.slice(-30),
    sn_res: agg.smart_note_resource_name?.slice(-30),
  }));
  return agg;
}
