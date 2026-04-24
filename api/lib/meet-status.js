const prisma = require('../../lib/prisma.cjs');

const STATUS_POS_ENVIO = new Set([
  'enfileirado',
  'processando',
  'processado',
  'erro',
  'ata_gerada',
  'ignorado',
]);

/**
 * Sincroniza epp_meet_status com o estado atual do epp_meet_process,
 * respeitando statuses pós-envio (não regride).
 *
 * @param {object} mp - registro de epp_meet_process
 * @param {boolean} artefatosCompletos - se 3/3 artefatos presentes
 * @param {object} aggregate - { first_event_at, last_event_at }
 */
async function syncMeetStatus(mp, artefatosCompletos, aggregate) {
  const existing = await prisma.eppMeetStatus.findUnique({
    where: { conference_id: mp.conference_id },
  });

  if (existing && STATUS_POS_ENVIO.has(existing.status)) {
    await prisma.eppMeetStatus.update({
      where: { conference_id: mp.conference_id },
      data: {
        has_recording: mp.has_recording,
        has_transcript: mp.has_transcript,
        has_smart_note: mp.has_smart_note,
        // Propagar title/start/end quando forem resolvidos depois da meet
        // já estar em pós-envio — cobre step 2/2c extraindo title do Calendar
        // ou evento 'ended' chegando após 'recording'/'transcript'.
        ...(mp.meeting_title && { meeting_title: mp.meeting_title }),
        ...(mp.meeting_start_time && { meeting_start_time: mp.meeting_start_time }),
        ...(mp.meeting_end_time && { meeting_end_time: mp.meeting_end_time }),
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

module.exports = { syncMeetStatus, STATUS_POS_ENVIO };
