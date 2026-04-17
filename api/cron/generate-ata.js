import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../lib/logger');
const prisma = require('../../lib/prisma.cjs');
const { extractFileIdFromDriveUrl } = require('../lib/google');
const {
  downloadDocAsText,
  uploadPdfToFolder,
  extractAtaJson,
  buildAtaHtml,
  renderHtmlToPdf,
  buildAtaFilename,
  flattenAtaJson,
} = require('../lib/ata-generator');

/**
 * POST /api/cron/generate-ata  body: { conference_id }
 *
 * Substitui o envio ao webhook externo (n8n). Fluxo interno:
 *  1. Baixa transcrição + anotação do Drive
 *  2. Chama Anthropic (Claude Sonnet 4.6) para extrair JSON
 *  3. Monta HTML da ata
 *  4. Converte HTML → PDF via PDFShift
 *  5. Faz upload do PDF na subpasta do conference_id
 *  6. UPSERT em epp_reunioes_governanca
 *  7. Atualiza epp_meet_status.status = 'ata_gerada'
 *
 * Protegido por CRON_SECRET.
 */
export default async function handler(req, res) {
  const startTime = Date.now();
  try {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { conference_id: conferenceId } = req.body || {};
    if (!conferenceId) return res.status(400).json({ error: 'conference_id é obrigatório' });

    logger.info(`[generate-ata] iniciando ${conferenceId}`);

    // Marca como "enviando" (reaproveita os estados existentes)
    await prisma.eppMeetStatus.update({
      where: { conference_id: conferenceId },
      data: { status: 'webhook_enviando', updated_at: new Date() },
    }).catch((e) => logger.warn('[generate-ata] falha ao marcar enviando', { error: e.message }));

    const mp = await prisma.eppMeetProcess.findUnique({ where: { conference_id: conferenceId } });
    if (!mp) {
      await markError(conferenceId, 'meet_process não encontrado');
      return res.status(200).json({ ok: false, error: 'not found' });
    }

    // Step 1 — Baixar docs (transcript/smart_note) do Drive
    const transcriptUrl = mp.transcript_drive_link || mp.transcript_original_link || '';
    const smartNoteUrl = mp.smart_note_drive_link || mp.smart_note_original_link || '';
    const transcriptFileId = extractFileIdFromDriveUrl(transcriptUrl);
    const smartNoteFileId = extractFileIdFromDriveUrl(smartNoteUrl);

    const [transcricao, anotacao] = await Promise.all([
      transcriptFileId ? downloadDocAsText(transcriptFileId, mp.user_email) : Promise.resolve(''),
      smartNoteFileId ? downloadDocAsText(smartNoteFileId, mp.user_email) : Promise.resolve(''),
    ]);

    if (!transcricao && !anotacao) {
      await markError(conferenceId, 'Nenhum texto disponível (transcrição e anotação vazias)');
      return res.status(200).json({ ok: false, error: 'no content' });
    }

    logger.info(`[generate-ata] docs baixados: transcrição=${transcricao.length}, anotação=${anotacao.length} chars`);

    // Step 2 — Chamar Anthropic
    const input = {
      email: mp.user_email,
      conference_id: conferenceId,
      url_gravacao: mp.recording_drive_link || mp.recording_original_link || '',
      url_transcricao: transcriptUrl,
      url_anotacao: smartNoteUrl,
      inicio_data: mp.meeting_start_time ? formatDateISO(mp.meeting_start_time) : '',
      inicio_hora: mp.meeting_start_time ? formatTimeISO(mp.meeting_start_time) : '',
      final_data: mp.meeting_end_time ? formatDateISO(mp.meeting_end_time) : '',
      final_hora: mp.meeting_end_time ? formatTimeISO(mp.meeting_end_time) : '',
      transcricao: transcricao.slice(0, 180000), // limite de segurança
      anotacao: anotacao.slice(0, 60000),
    };

    let ataJson;
    try {
      ataJson = await extractAtaJson(input);
    } catch (err) {
      await markError(conferenceId, `Anthropic falhou: ${err.message}`);
      return res.status(200).json({ ok: false, error: err.message });
    }

    logger.info(`[generate-ata] JSON extraído: ${ataJson.titulo_reuniao}`);

    // Step 3 — Montar HTML
    const html = buildAtaHtml(ataJson);

    // Step 4 — HTML → PDF
    let pdfBuffer;
    try {
      pdfBuffer = await renderHtmlToPdf(html);
    } catch (err) {
      await markError(conferenceId, `PDF falhou: ${err.message}`);
      return res.status(200).json({ ok: false, error: err.message });
    }

    // Step 5 — Upload para Drive
    if (!mp.drive_folder_id) {
      await markError(conferenceId, 'drive_folder_id ausente em meet_process');
      return res.status(200).json({ ok: false, error: 'no folder' });
    }

    const fileName = buildAtaFilename({
      user_email: mp.user_email,
      meeting_start_time: mp.meeting_start_time,
      meeting_end_time: mp.meeting_end_time,
      titulo_reuniao: ataJson.titulo_reuniao,
    });

    let uploaded;
    try {
      uploaded = await uploadPdfToFolder(pdfBuffer, mp.drive_folder_id, fileName, mp.user_email);
    } catch (err) {
      await markError(conferenceId, `Upload Drive falhou: ${err.message}`);
      return res.status(200).json({ ok: false, error: err.message });
    }

    logger.info(`[generate-ata] PDF upload OK: ${uploaded.id}`);

    // Step 6 — UPSERT em epp_reunioes_governanca
    const flat = flattenAtaJson(ataJson);
    const dataReuniao = mp.meeting_start_time ? new Date(mp.meeting_start_time) : null;
    const horaInicio = mp.meeting_start_time ? formatTimeISO(mp.meeting_start_time) : null;
    const horaFim = mp.meeting_end_time ? formatTimeISO(mp.meeting_end_time) : null;

    const governanca = {
      id: `${mp.meeting_start_time || conferenceId} | ${horaFim || ''} | ${mp.user_email} | ${ataJson.titulo_reuniao || ''}`.slice(0, 255),
      conference_id: conferenceId,
      data_reuniao: dataReuniao,
      hora_inicio: horaInicio,
      hora_fim: horaFim,
      responsavel: mp.user_email,
      anotacao: anotacao || null,
      transcricao: transcricao || null,
      link_anotacao: smartNoteUrl || null,
      link_transcricao: transcriptUrl || null,
      link_gravacao: mp.recording_drive_link || mp.recording_original_link || null,
      ata: html,
      ata_pdf_link: uploaded.webViewLink || null,
      ata_link_download: uploaded.webContentLink || null,
      ...flat,
    };

    await prisma.eppReunioesGovernanca.upsert({
      where: { conference_id: conferenceId },
      create: governanca,
      update: governanca,
    });

    // Step 7 — Atualizar meet_status
    await prisma.eppMeetStatus.update({
      where: { conference_id: conferenceId },
      data: {
        status: 'ata_gerada',
        data_ata_gerada: new Date(),
        data_webhook_enviado: new Date(),
        webhook_last_status_code: 200,
        webhook_last_response: `PDF: ${uploaded.webViewLink}`,
        webhook_last_error: null,
        updated_at: new Date(),
      },
    }).catch((e) => logger.warn('[generate-ata] falha ao atualizar status', { error: e.message }));

    logger.info(`[generate-ata] ${conferenceId} concluído em ${Date.now() - startTime}ms`);
    return res.status(200).json({
      ok: true,
      conference_id: conferenceId,
      pdf_link: uploaded.webViewLink,
      pdf_id: uploaded.id,
      titulo: ataJson.titulo_reuniao,
    });
  } catch (error) {
    logger.error('[generate-ata] ERRO FATAL', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: error.message });
  }
}

async function markError(conferenceId, message) {
  try {
    await prisma.eppMeetStatus.update({
      where: { conference_id: conferenceId },
      data: {
        status: 'webhook_erro',
        webhook_last_error: String(message).slice(0, 2000),
        data_ultimo_erro: new Date(),
        updated_at: new Date(),
      },
    });
  } catch (e) {
    logger.warn('[generate-ata] não consegui marcar erro', { error: e.message });
  }
}

function formatDateISO(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const tz = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const dd = String(tz.getUTCDate()).padStart(2, '0');
  const mm = String(tz.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = tz.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatTimeISO(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const tz = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const hh = String(tz.getUTCHours()).padStart(2, '0');
  const mm = String(tz.getUTCMinutes()).padStart(2, '0');
  const ss = String(tz.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
