const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk').default;
const logger = require('./logger');
const config = require('./config');

// ============================================================
// Drive helpers
// ============================================================

function getDriveClientForUser(impersonatedEmail) {
  const auth = new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: config.google.scopes,
    subject: impersonatedEmail,
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Baixa o conteúdo de um Google Doc como texto simples.
 * Retorna string vazia em caso de erro.
 */
async function downloadDocAsText(fileId, impersonatedEmail) {
  if (!fileId) return '';
  try {
    const drive = getDriveClientForUser(impersonatedEmail);
    const { data } = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'text' }
    );
    return typeof data === 'string' ? data : String(data || '');
  } catch (err) {
    logger.warn(`[ata] falha ao exportar doc ${fileId}: ${err.message}`);
    return '';
  }
}

/**
 * Faz upload de um Buffer PDF para uma pasta do Drive, retornando { id, webViewLink, webContentLink }.
 */
async function uploadPdfToFolder(pdfBuffer, folderId, fileName, impersonatedEmail) {
  const drive = getDriveClientForUser(impersonatedEmail);
  const { Readable } = require('stream');
  const body = Readable.from(pdfBuffer);
  const { data } = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/pdf',
    },
    media: { mimeType: 'application/pdf', body },
    fields: 'id,name,webViewLink,webContentLink',
    supportsAllDrives: true,
  });
  try {
    await drive.permissions.create({
      fileId: data.id,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    });
  } catch (err) {
    logger.warn(`[ata] falha ao setar anyone reader em ${data.id}: ${err.message}`);
  }
  return data;
}

// ============================================================
// Anthropic — extrai JSON estruturado da transcrição
// ============================================================

const SYSTEM_PROMPT = `You are an expert AI agent specialized in analyzing meeting transcriptions and extracting structured data for professional meeting minutes (atas de reunião). Your role is to parse meeting data and organize it into a standardized JSON format.

## Output format (return ONLY valid JSON, no markdown, no explanations):

{
  "titulo_reuniao": "string",
  "data_inicio": "DD/MM/YYYY",
  "hora_inicio": "HH:MM:SS",
  "hora_final": "HH:MM:SS",
  "duracao_minutos": "number",
  "local_meio": "string",
  "email_organizador": "string",
  "participantes": [{ "nome": "string", "area": "string", "papel": "string" }],
  "objetivo_reuniao": "string",
  "itens_pauta": [{ "numero": "number", "titulo": "string", "descricao": "string" }],
  "deliberacoes": [{ "numero": "number", "titulo": "string", "discussao": "string", "deliberacao": "string" }],
  "acoes_definidas": [{ "numero": "number", "acao": "string", "responsavel": "string", "prazo": "string", "observacao": "string" }],
  "proximas_etapas": ["string"],
  "documentos_referencia": { "transcricao_url": "string or null", "gravacao_url": "string or null", "anotacao_url": "string or null" },
  "resumo_executivo": "string",
  "data_encerramento": "DD/MM/YYYY",
  "hora_encerramento": "HH:MM:SS"
}

## Rules
1. Names: capitalized properly (Vinicius Leandro)
2. Dates: DD/MM/YYYY  |  Times: HH:MM:SS
3. Use "•" prefix for bullet points inside discussao/deliberacao
4. Use "A definir" for missing deadlines
5. Use null for missing URLs (not the string "null")
6. Professional Portuguese
7. Return pure JSON, no markdown fences`;

function buildUserPrompt(input) {
  return `Analyze the following meeting data and extract all relevant information.

## Input
\`\`\`json
${JSON.stringify(input, null, 2)}
\`\`\`

## Task
1. Analyze the transcription carefully
2. Extract participants, agenda, discussions, deliberations, action items, next steps
3. Generate a descriptive meeting title (5-10 words) based on the main topics
4. If one of the artifacts is missing (transcription or notes), analyze what IS available. Do not analyze video.
5. Return ONLY valid JSON matching the structure in the system prompt.`;
}

/**
 * Se Claude bateu max_tokens no meio do JSON, tenta fechar chaves/colchetes
 * pendentes pra salvar o máximo de dados possível.
 * Retorna objeto parseado ou null se não conseguir recuperar.
 */
function tryRecoverTruncatedJson(partial) {
  if (!partial || partial.length < 2) return null;
  // Varre contando estruturas abertas, ignorando conteúdo dentro de strings.
  const stack = [];
  let inString = false;
  let escape = false;
  let lastValidEnd = -1;
  for (let i = 0; i < partial.length; i++) {
    const ch = partial[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length === 0) lastValidEnd = i;
    }
  }

  // Se acabou dentro de string, fecha a string.
  let fixed = partial;
  if (inString) fixed += '"';
  // Remove vírgula/dois-pontos pendente antes do fecho.
  fixed = fixed.replace(/[,:]\s*$/, '');
  // Fecha estruturas pendentes na ordem inversa.
  while (stack.length) {
    fixed += stack.pop() === '{' ? '}' : ']';
  }
  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

function parseJsonFromResponse(text, stopReason) {
  if (!text) throw new Error('Resposta vazia da Anthropic');
  let str = text.trim();
  const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) str = fence[1].trim();
  const first = str.indexOf('{');
  const last = str.lastIndexOf('}');
  if (first === -1) throw new Error('JSON não encontrado na resposta');
  // Se o modelo truncou em max_tokens, last pode ser -1 ou o JSON pode estar
  // incompleto mesmo com } encontrado. Tenta parsear; se falhar, usa recovery.
  const json = last > first ? str.slice(first, last + 1) : str.slice(first);
  try {
    return JSON.parse(json);
  } catch (err) {
    const recovered = tryRecoverTruncatedJson(str.slice(first));
    if (recovered) {
      logger.warn(`[ata] JSON truncado recuperado (stop_reason=${stopReason || 'unknown'}, tamanho=${json.length})`);
      return recovered;
    }
    throw new Error(`JSON malformado (${err.message.slice(0, 120)}). Tamanho: ${json.length}, stop_reason: ${stopReason || 'unknown'}`);
  }
}

async function extractAtaJson(input) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY ausente');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 32000, // era 8192 — reuniões longas geram JSON >23k chars e truncavam
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  });
  const block = message.content?.find((b) => b.type === 'text');
  const text = block?.text || '';
  return parseJsonFromResponse(text, message.stop_reason);
}

// ============================================================
// HTML template — ata de reunião
// ============================================================

function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMultiline(s) {
  if (!s) return '';
  return escapeHtml(s).replace(/\n/g, '<br/>');
}

const LOGO_SVG = `<svg viewBox="0 0 1080 615" xmlns="http://www.w3.org/2000/svg" style="width:120px;height:auto"><path fill="#CC0000" d="M1080,0v150c-46.95,0-92.25,7.05-135,20.1v444.9s-150,0-150,0V247.8c-109.5,85.2-180,218.1-180,367.2h-150c0-149.1-70.5-282-180-367.2v367.2s-150,0-150,0V170.1c-42.75-13.05-88.05-20.1-135-20.1V0c232.8,0,435.6,129.9,540,321C644.4,129.9,847.2,0,1080,0Z"/></svg>`;

function buildAtaHtml(data) {
  const participantes = (data.participantes || [])
    .map(
      (p) =>
        `<tr><td style="border:1px solid #000;padding:6px 10px">${escapeHtml(p.nome)}</td><td style="border:1px solid #000;padding:6px 10px">${escapeHtml(p.area)}</td></tr>`
    )
    .join('');

  const pautaItems = (data.itens_pauta || [])
    .map(
      (i) =>
        `<div style="margin:0 0 8px 10px"><strong>${escapeHtml(i.numero)}. ${escapeHtml(i.titulo)}</strong>${i.descricao ? `<br/><em style="color:#444">${escapeHtml(i.descricao)}</em>` : ''}</div>`
    )
    .join('');

  const deliberacoesItems = (data.deliberacoes || [])
    .map(
      (d) =>
        `<div style="margin:0 0 16px 0;padding:10px;border:1px solid #ccc;border-radius:4px">
          <strong>${escapeHtml(d.numero)}. ${escapeHtml(d.titulo)}</strong>
          <div style="margin-top:8px"><span style="color:#D90429;font-weight:bold">Discussão:</span><br/>${formatMultiline(d.discussao)}</div>
          <div style="margin-top:8px"><span style="color:#D90429;font-weight:bold">Deliberação:</span><br/>${formatMultiline(d.deliberacao)}</div>
        </div>`
    )
    .join('');

  const acoesRows = (data.acoes_definidas || [])
    .map(
      (a, idx) =>
        `<tr>
          <td style="border:1px solid #000;padding:6px 10px;text-align:center">${a.numero || idx + 1}</td>
          <td style="border:1px solid #000;padding:6px 10px">${escapeHtml(a.acao)}</td>
          <td style="border:1px solid #000;padding:6px 10px">${escapeHtml(a.responsavel)}</td>
          <td style="border:1px solid #000;padding:6px 10px">${escapeHtml(a.prazo || 'A definir')}</td>
          <td style="border:1px solid #000;padding:6px 10px">${escapeHtml(a.observacao || '')}</td>
        </tr>`
    )
    .join('');

  const proximas = (data.proximas_etapas || [])
    .map((p) => `<li>${escapeHtml(p)}</li>`)
    .join('');

  const horario = `${data.hora_inicio || '—'} às ${data.hora_final || '—'}`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Ata — ${escapeHtml(data.titulo_reuniao || 'Reunião')}</title>
<style>
  @page { size: A4; margin: 20mm 15mm 20mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #000; font-size: 11pt; line-height: 1.5; margin: 0; padding: 0; }
  h1, h2, h3, h4, p, div, table { page-break-inside: avoid; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; }
  .section-title { color: #D90429; font-weight: bold; font-size: 13pt; margin: 16px 0 8px 0; page-break-after: avoid; }
</style>
</head>
<body>

<!-- CABEÇALHO -->
<table style="border:2px solid #000;margin-bottom:16px">
  <tr>
    <td rowspan="5" style="border:1px solid #000;padding:10px;width:150px;vertical-align:middle;text-align:center">
      ${LOGO_SVG}
    </td>
    <td colspan="2" style="border:1px solid #000;padding:10px;text-align:center;font-size:16pt;font-weight:bold">ATA DE REUNIÃO</td>
  </tr>
  <tr><td style="border:1px solid #000;padding:6px 10px;font-weight:bold;width:120px">Data:</td><td style="border:1px solid #000;padding:6px 10px">${escapeHtml(data.data_inicio)}</td></tr>
  <tr><td style="border:1px solid #000;padding:6px 10px;font-weight:bold">Horário:</td><td style="border:1px solid #000;padding:6px 10px">${escapeHtml(horario)} (GMT-03:00)</td></tr>
  <tr><td style="border:1px solid #000;padding:6px 10px;font-weight:bold">Local / Meio:</td><td style="border:1px solid #000;padding:6px 10px">${escapeHtml(data.local_meio || 'Google Meet')}</td></tr>
  <tr><td style="border:1px solid #000;padding:6px 10px;font-weight:bold">Pauta / Projeto:</td><td style="border:1px solid #000;padding:6px 10px">${escapeHtml(data.titulo_reuniao)}</td></tr>
</table>

<!-- 1. PARTICIPANTES -->
<p class="section-title">1. Participantes</p>
<table style="border:2px solid #000;margin-bottom:16px">
  <tr>
    <th style="border:1px solid #000;padding:6px 10px;background:#f0f0f0;text-align:left">Nome</th>
    <th style="border:1px solid #000;padding:6px 10px;background:#f0f0f0;text-align:left">Área</th>
  </tr>
  ${participantes || '<tr><td colspan="2" style="border:1px solid #000;padding:6px 10px;color:#666"><em>Não identificados</em></td></tr>'}
</table>

<!-- 2. OBJETIVO -->
<p class="section-title">2. Objetivo da Reunião</p>
<div style="margin:0 0 16px 10px">${formatMultiline(data.objetivo_reuniao) || '—'}</div>

<!-- 3. PAUTA -->
<p class="section-title">3. Pauta</p>
<div style="margin:0 0 16px 0">${pautaItems || '<div style="margin-left:10px;color:#666"><em>Sem itens de pauta</em></div>'}</div>

<!-- 4. DELIBERAÇÕES / DISCUSSÕES -->
<p class="section-title">4. Deliberações / Discussões</p>
<div style="margin:0 0 16px 10px">${deliberacoesItems || '<em style="color:#666">Sem deliberações registradas</em>'}</div>

<!-- 5. AÇÕES -->
<p class="section-title">5. Principais Saídas / Ações / Responsáveis / Prazos</p>
<table style="border:2px solid #000;margin-bottom:16px">
  <tr>
    <th style="border:1px solid #000;padding:6px 10px;background:#f0f0f0;text-align:center;width:40px">Nº</th>
    <th style="border:1px solid #000;padding:6px 10px;background:#f0f0f0;text-align:left">Ação</th>
    <th style="border:1px solid #000;padding:6px 10px;background:#f0f0f0;text-align:left">Responsável</th>
    <th style="border:1px solid #000;padding:6px 10px;background:#f0f0f0;text-align:left">Prazo</th>
    <th style="border:1px solid #000;padding:6px 10px;background:#f0f0f0;text-align:left">Observação</th>
  </tr>
  ${acoesRows || '<tr><td colspan="5" style="border:1px solid #000;padding:6px 10px;color:#666"><em>Sem ações definidas</em></td></tr>'}
</table>

<!-- 6. RESUMO EXECUTIVO -->
<p class="section-title">6. Resumo Executivo</p>
<div style="margin:0 0 16px 10px;padding:12px;border-left:4px solid #D90429;background:#FFF3F3">${formatMultiline(data.resumo_executivo) || '—'}</div>

<!-- 7. PRÓXIMAS ETAPAS -->
<p class="section-title">7. Próximas Etapas</p>
<ul style="margin:0 0 16px 30px">${proximas || '<li><em style="color:#666">Sem próximas etapas registradas</em></li>'}</ul>

<!-- 8. ENCERRAMENTO -->
<p class="section-title">8. Encerramento</p>
<div style="margin:0 0 8px 10px">
  Reunião encerrada em ${escapeHtml(data.data_encerramento || data.data_inicio)}${data.hora_encerramento ? ` às ${escapeHtml(data.hora_encerramento)}` : ''}.
</div>

</body>
</html>`;
}

// ============================================================
// PDFShift — HTML para PDF
// ============================================================

async function renderHtmlToPdf(html) {
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) throw new Error('PDFSHIFT_API_KEY ausente');
  const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: html,
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      use_print: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PDFShift ${res.status}: ${text.slice(0, 500)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ============================================================
// Helpers de formatação de nome de arquivo
// ============================================================

function pessoaFromEmail(email) {
  if (!email) return 'Usuário';
  const local = email.includes('@') ? email.split('@')[0] : email;
  return local
    .split('.')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function formatDateBR(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const tz = new Date(date.getTime() - 3 * 60 * 60 * 1000); // GMT-3
  const dd = String(tz.getUTCDate()).padStart(2, '0');
  const mm = String(tz.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = tz.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const tz = new Date(date.getTime() - 3 * 60 * 60 * 1000); // GMT-3
  const hh = String(tz.getUTCHours()).padStart(2, '0');
  const mm = String(tz.getUTCMinutes()).padStart(2, '0');
  return `${hh}h${mm}`;
}

function sanitizeFilename(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

function buildAtaFilename({ user_email, meeting_start_time, meeting_end_time, titulo_reuniao }) {
  const pessoa = pessoaFromEmail(user_email);
  const data = formatDateBR(meeting_start_time);
  const ini = formatTime(meeting_start_time);
  const fim = formatTime(meeting_end_time);
  const titulo = sanitizeFilename(titulo_reuniao || 'Reunião');
  const horarios = [ini, fim].filter(Boolean).join('-');
  const parts = ['Ata', pessoa, [data, horarios].filter(Boolean).join(' '), titulo].filter(Boolean);
  return sanitizeFilename(parts.join(' | ')) + '.pdf';
}

// ============================================================
// Flatten do JSON para colunas de epp_reunioes_governanca
// ============================================================

function flattenAtaJson(data) {
  const joinBy = (arr, sep, fn) => (arr || []).map(fn).filter(Boolean).join(sep);
  return {
    titulo_reuniao: data.titulo_reuniao || null,
    local_meio: data.local_meio || null,
    participantes_nomes: joinBy(data.participantes, ', ', (p) => p.nome),
    participantes_areas: joinBy(data.participantes, ', ', (p) => p.area),
    objetivo_reuniao: data.objetivo_reuniao || null,
    itens_pauta_titulos: joinBy(data.itens_pauta, ', ', (i) => i.titulo),
    itens_pauta_completo: joinBy(data.itens_pauta, ', ', (i) => `${i.titulo}${i.descricao ? `: ${i.descricao}` : ''}`),
    deliberacoes_titulos: joinBy(data.deliberacoes, ', ', (d) => d.titulo),
    deliberacoes_discussoes: joinBy(data.deliberacoes, ' | ', (d) => (d.discussao || '').replace(/\n/g, ' ')),
    deliberacoes_decisoes: joinBy(data.deliberacoes, ' | ', (d) => (d.deliberacao || '').replace(/\n/g, ' ')),
    acoes_lista: joinBy(data.acoes_definidas, ', ', (a) => a.acao),
    acoes_responsaveis: joinBy(data.acoes_definidas, ', ', (a) => a.responsavel),
    proximas_etapas: (data.proximas_etapas || []).join(', '),
    resumo_executivo: data.resumo_executivo || null,
  };
}

module.exports = {
  downloadDocAsText,
  uploadPdfToFolder,
  extractAtaJson,
  buildAtaHtml,
  renderHtmlToPdf,
  buildAtaFilename,
  flattenAtaJson,
  pessoaFromEmail,
};
