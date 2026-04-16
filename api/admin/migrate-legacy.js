import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const prisma = require('../../lib/prisma.cjs');

/**
 * POST /api/admin/migrate-legacy
 *
 * Migra dados retroativos de epp_reunioes_governanca para epp_meet_status.
 * Roda uma vez para popular os cards na aba Reuniões com dados antigos.
 *
 * Protegido por CRON_SECRET.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[migrate] Iniciando migração retroativa...');

    // 1. Migrar de epp_reunioes_governanca (reuniões com ata/links)
    const governancas = await prisma.eppReunioesGovernanca.findMany();
    console.log(`[migrate] ${governancas.length} reuniões em governança`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const g of governancas) {
      try {
        const existing = await prisma.eppMeetStatus.findUnique({
          where: { conference_id: g.conference_id },
        });
        if (existing) {
          skipped++;
          continue;
        }

        const hasAta = !!(g.ata && g.ata.trim().length > 0);
        const hasRecording = !!g.link_gravacao;
        const hasTranscript = !!g.link_transcricao;
        const hasSmartNote = !!g.link_anotacao;
        const allArtifacts = hasRecording && hasTranscript && hasSmartNote;

        let status = 'artefatos_faltantes';
        if (hasAta) status = 'ata_gerada';
        else if (allArtifacts) status = 'artefatos_completos';

        await prisma.eppMeetStatus.create({
          data: {
            conference_id: g.conference_id,
            status,
            user_email: g.responsavel || 'unknown@meet.google.com',
            meeting_title: g.titulo_reuniao || 'Reunião do Google Meet',
            meeting_start_time: g.data_reuniao,
            has_recording: hasRecording,
            has_transcript: hasTranscript,
            has_smart_note: hasSmartNote,
            ...(hasAta && { data_ata_gerada: new Date() }),
            ...(allArtifacts && { data_artefatos_completos: new Date() }),
          },
        });
        created++;
      } catch (e) {
        console.error(`[migrate] erro em ${g.conference_id}: ${e.message}`);
        errors++;
      }
    }

    // 2. Migrar de epp_conference_artifact_tracking (tabela antiga, se existir)
    let trackingCreated = 0;
    try {
      const trackingRows = await prisma.$queryRaw`
        SELECT * FROM lovable.epp_conference_artifact_tracking
        ORDER BY created_at DESC
        LIMIT 500
      `;
      console.log(`[migrate] ${trackingRows.length} registros na tabela antiga de tracking`);

      for (const t of trackingRows) {
        try {
          const existing = await prisma.eppMeetStatus.findUnique({
            where: { conference_id: t.conference_id },
          });
          if (existing) continue;

          const allArtifacts = t.has_recording && t.has_transcript && t.has_smart_note;
          let status = 'artefatos_faltantes';
          if (allArtifacts) status = 'artefatos_completos';

          await prisma.eppMeetStatus.create({
            data: {
              conference_id: t.conference_id,
              status,
              user_email: t.user_email || 'unknown@meet.google.com',
              meeting_title: 'Reunião do Google Meet',
              has_recording: !!t.has_recording,
              has_transcript: !!t.has_transcript,
              has_smart_note: !!t.has_smart_note,
              data_primeiro_artefato: t.first_event_at,
              data_ultimo_artefato: t.last_event_at,
              ...(allArtifacts && { data_artefatos_completos: t.last_event_at }),
            },
          });
          trackingCreated++;
        } catch (e) {
          // pode falhar por tabela inexistente ou constraint — ignorar
        }
      }
    } catch (e) {
      console.log(`[migrate] tabela antiga de tracking não acessível: ${e.message}`);
    }

    // 3. Popular epp_meet_process retroativamente para links (dos que têm URLs na governanca)
    let processCreated = 0;
    for (const g of governancas) {
      try {
        const existing = await prisma.eppMeetProcess.findUnique({
          where: { conference_id: g.conference_id },
        });
        if (existing) continue;

        await prisma.eppMeetProcess.create({
          data: {
            conference_id: g.conference_id,
            user_email: g.responsavel || 'unknown@meet.google.com',
            status: 'complete',
            meeting_title: g.titulo_reuniao,
            meeting_start_time: g.data_reuniao,
            has_recording: !!g.link_gravacao,
            has_transcript: !!g.link_transcricao,
            has_smart_note: !!g.link_anotacao,
            recording_original_link: g.link_gravacao,
            transcript_original_link: g.link_transcricao,
            smart_note_original_link: g.link_anotacao,
            // Links do Drive interno = mesmos (originais, já que não temos cópias retroativas)
            recording_drive_link: g.link_gravacao,
            transcript_drive_link: g.link_transcricao,
            smart_note_drive_link: g.link_anotacao,
          },
        });
        processCreated++;
      } catch (e) {
        // ignorar duplicatas
      }
    }

    const summary = {
      governanca_total: governancas.length,
      meet_status_created: created,
      meet_status_skipped: skipped,
      meet_status_errors: errors,
      tracking_migrated: trackingCreated,
      meet_process_created: processCreated,
    };

    console.log('[migrate] Concluído:', JSON.stringify(summary));
    return res.status(200).json({ success: true, ...summary });
  } catch (error) {
    console.error('[migrate] ERRO:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
