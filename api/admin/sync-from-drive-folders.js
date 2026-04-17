import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const prisma = require('../../lib/prisma.cjs');
const {
  extractFolderIdFromDriveUrl,
  listSubfoldersInFolder,
  listFilesInFolder,
  classifyDriveFile,
  extractMeetingTitleFromFileName,
} = require('../lib/google');
const { syncMeetStatus } = require('../lib/meet-status');

const CONFERENCE_ID_RE = /^(conferenceRecords\/)?[a-zA-Z0-9_-]{8,}$/;

/**
 * POST /api/admin/sync-from-drive-folders
 *
 * Faz backfill dos links dos artefatos a partir dos arquivos já presentes nas
 * subpastas `{conference_id}` dentro de cada `pasta_destino` em `epp_user_pastas`.
 *
 * Body (todos opcionais):
 *   { user_email?: string, conference_id?: string, dry_run?: boolean }
 *
 * Protegido por Bearer CRON_SECRET.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { user_email: filterEmail, conference_id: filterCid, dry_run } = req.body || {};
  const dryRun = !!dry_run;

  const summary = {
    total_users: 0,
    users_processed: 0,
    users_skipped: 0,
    total_subfolders: 0,
    skipped_name_invalid: 0,
    skipped_empty: 0,
    upserted: 0,
    classified: { recording: 0, transcript: 0, smart_note: 0 },
    errors: [],
    dry_run: dryRun,
    samples: [],
  };

  try {
    const whereUsers = { pasta_destino: { not: null } };
    if (filterEmail) whereUsers.user_email = filterEmail;

    const users = await prisma.eppUserPastas.findMany({ where: whereUsers });
    summary.total_users = users.length;

    for (const u of users) {
      const pastaDestinoId = extractFolderIdFromDriveUrl(u.pasta_destino);
      if (!pastaDestinoId) {
        summary.users_skipped += 1;
        summary.errors.push({ user_email: u.user_email, error: 'pasta_destino inválida', raw: u.pasta_destino });
        continue;
      }

      let subfolders;
      try {
        // Impersonar o próprio usuário (é quem criou/tem acesso à pasta)
        subfolders = await listSubfoldersInFolder(pastaDestinoId, u.user_email);
      } catch (err) {
        summary.users_skipped += 1;
        summary.errors.push({ user_email: u.user_email, pasta_destino_id: pastaDestinoId, error: `list subfolders: ${err.message}` });
        continue;
      }

      summary.users_processed += 1;
      summary.total_subfolders += subfolders.length;
      if (summary.samples.length < 15) {
        summary.samples.push({
          user_email: u.user_email,
          pasta_destino_raw: u.pasta_destino,
          pasta_destino_id: pastaDestinoId,
          subfolder_count: subfolders.length,
          first_names: subfolders.slice(0, 3).map((s) => s.name),
        });
      }

      for (const sub of subfolders) {
        const cid = sub.name;
        if (filterCid && cid !== filterCid) continue;
        if (!CONFERENCE_ID_RE.test(cid)) {
          summary.skipped_name_invalid += 1;
          continue;
        }

        let files;
        try {
          files = await listFilesInFolder(sub.id, u.user_email);
        } catch (err) {
          summary.errors.push({ conference_id: cid, user_email: u.user_email, error: `list files: ${err.message}` });
          continue;
        }

        if (!files.length) {
          summary.skipped_empty += 1;
          continue;
        }

        // Pega o primeiro arquivo de cada tipo (menor createdTime, desempate por name)
        const byKind = { recording: null, transcript: null, smart_note: null };
        const sorted = [...files].sort((a, b) => {
          const ta = a.createdTime ? new Date(a.createdTime).getTime() : 0;
          const tb = b.createdTime ? new Date(b.createdTime).getTime() : 0;
          if (ta !== tb) return ta - tb;
          return (a.name || '').localeCompare(b.name || '');
        });
        for (const f of sorted) {
          const kind = classifyDriveFile({ name: f.name, mimeType: f.mimeType });
          if (!kind) continue;
          if (!byKind[kind]) byKind[kind] = f;
        }

        const classified = ['recording', 'transcript', 'smart_note'].filter((k) => byKind[k]);
        if (!classified.length) {
          summary.skipped_empty += 1;
          continue;
        }

        for (const k of classified) summary.classified[k] += 1;

        // Título candidato: primeiro arquivo não-nulo
        const firstFile = byKind.recording || byKind.transcript || byKind.smart_note;
        const titleCandidate = firstFile ? extractMeetingTitleFromFileName(firstFile.name) : null;

        const createData = {
          conference_id: cid,
          user_email: u.user_email,
          status: 'pending',
          drive_folder_id: sub.id,
          drive_folder_link: sub.webViewLink || null,
          drive_folder_created_at: sub.createdTime ? new Date(sub.createdTime) : new Date(),
          ...(titleCandidate && { meeting_title: titleCandidate }),
        };
        const updateData = {
          drive_folder_id: sub.id,
          ...(sub.webViewLink && { drive_folder_link: sub.webViewLink }),
          ...(sub.createdTime && { drive_folder_created_at: new Date(sub.createdTime) }),
          updated_at: new Date(),
        };
        for (const k of classified) {
          const f = byKind[k];
          createData[`${k}_drive_file_id`] = f.id;
          createData[`${k}_drive_link`] = f.webViewLink || null;
          createData[`${k}_copied_at`] = f.createdTime ? new Date(f.createdTime) : new Date();
          createData[`has_${k}`] = true;
          createData[`${k}_error`] = null;

          updateData[`${k}_drive_file_id`] = f.id;
          if (f.webViewLink) updateData[`${k}_drive_link`] = f.webViewLink;
          updateData[`${k}_copied_at`] = f.createdTime ? new Date(f.createdTime) : new Date();
          updateData[`has_${k}`] = true;
          updateData[`${k}_error`] = null;
        }

        if (dryRun) {
          if (summary.samples.length < 20) {
            summary.samples.push({
              conference_id: cid,
              user_email: u.user_email,
              folder_id: sub.id,
              title: titleCandidate,
              classified,
            });
          }
          summary.upserted += 1;
          continue;
        }

        try {
          // Só setamos meeting_title no update se estava NULL
          const existing = await prisma.eppMeetProcess.findUnique({
            where: { conference_id: cid },
            select: { meeting_title: true, user_email: true },
          });
          if (!existing?.meeting_title && titleCandidate) {
            updateData.meeting_title = titleCandidate;
          }

          await prisma.eppMeetProcess.upsert({
            where: { conference_id: cid },
            create: createData,
            update: updateData,
          });

          // Sincroniza epp_meet_status (respeita STATUS_POS_ENVIO)
          const mp = await prisma.eppMeetProcess.findUnique({ where: { conference_id: cid } });
          const artefatosCompletos = mp.has_recording && mp.has_transcript && mp.has_smart_note;
          const times = classified
            .map((k) => byKind[k].createdTime)
            .filter(Boolean)
            .map((t) => new Date(t));
          const firstAt = times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : new Date();
          const lastAt = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : new Date();
          await syncMeetStatus(mp, artefatosCompletos, { first_event_at: firstAt, last_event_at: lastAt });

          summary.upserted += 1;
        } catch (err) {
          console.error(`[sync-drive] erro em ${cid}: ${err.message}`);
          summary.errors.push({ conference_id: cid, user_email: u.user_email, error: err.message });
        }
      }
    }

    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error('[sync-drive] ERRO FATAL:', err.message);
    return res.status(500).json({ error: err.message, summary });
  }
}
