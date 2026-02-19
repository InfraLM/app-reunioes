import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../lib/prisma.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(authMiddleware);

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function formatarData(data: Date | null | undefined): string {
  if (!data) return 'não informada';
  return new Date(data).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function truncar(texto: string | null | undefined, limite: number): string {
  if (!texto) return '';
  if (texto.length <= limite) return texto;
  return texto.substring(0, limite) + '... [continua]';
}

function buildSystemPrompt(reunioes: any[]): string {
  const agora = new Date();
  const hoje = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  const ontemStr = ontem.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  let prompt = `Você é o Ialdo, analista de reuniões da Liberdade Médica. Seu trabalho é responder perguntas sobre as reuniões de governança que aconteceram na empresa — você acompanhou todas elas.

Fale de forma natural e direta, como um colega de trabalho que manja de tudo que rolou nas reuniões. Sem saudações formais longas. Pode usar uma linguagem mais informal mas ainda profissional. Responda em português brasileiro.

📅 Hoje é ${hoje}. Ontem foi ${ontemStr}.

Dicas de comportamento:
- Se perguntarem "o que rolou ontem?" ou "reuniões de ontem", procure reuniões com data_reuniao = ${ontemStr}
- Se pedirem sobre uma reunião específica pelo nome dos participantes (ex: "reunião do Vinicius com o Bruno"), identifique pelo campo de participantes ou responsável
- Se pedirem a ata, forneça o ata_link_download se disponível, caso contrário diga que não há link cadastrado
- Se perguntarem sobre decisões ou deliberações, use os campos deliberacoes_decisoes e resumo_executivo
- Se perguntarem sobre ações ou pendências, use os campos acoes_lista e acoes_responsaveis
- Seja objetivo nos resumos — bullet points funcionam bem
- Se não tiver informação suficiente sobre algo, seja honesto

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REUNIÕES CADASTRADAS (${reunioes.length} no total):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  for (const r of reunioes) {
    prompt += `\n[REUNIÃO]\n`;
    if (r.titulo_reuniao) prompt += `Título: ${r.titulo_reuniao}\n`;
    if (r.data_reuniao) prompt += `Data: ${formatarData(r.data_reuniao)}\n`;
    if (r.hora_inicio || r.hora_fim) prompt += `Horário: ${r.hora_inicio ?? '?'} até ${r.hora_fim ?? '?'}\n`;
    if (r.responsavel) prompt += `Responsável: ${r.responsavel}\n`;
    if (r.local_meio) prompt += `Meio: ${r.local_meio}\n`;
    if (r.participantes_nomes) prompt += `Participantes: ${r.participantes_nomes}\n`;
    if (r.participantes_areas) prompt += `Áreas: ${r.participantes_areas}\n`;
    if (r.objetivo_reuniao) prompt += `Objetivo: ${truncar(r.objetivo_reuniao, 600)}\n`;
    if (r.itens_pauta_titulos) prompt += `Pauta: ${r.itens_pauta_titulos}\n`;
    if (r.deliberacoes_titulos) prompt += `Tópicos deliberados: ${r.deliberacoes_titulos}\n`;
    if (r.deliberacoes_decisoes) prompt += `Decisões: ${truncar(r.deliberacoes_decisoes, 1200)}\n`;
    if (r.acoes_lista) prompt += `Ações definidas: ${truncar(r.acoes_lista, 1000)}\n`;
    if (r.acoes_responsaveis) prompt += `Responsáveis pelas ações: ${r.acoes_responsaveis}\n`;
    if (r.proximas_etapas) prompt += `Próximas etapas: ${truncar(r.proximas_etapas, 800)}\n`;
    if (r.resumo_executivo) prompt += `Resumo executivo: ${truncar(r.resumo_executivo, 1500)}\n`;

    const links: string[] = [];
    if (r.link_gravacao) links.push(`Gravação: ${r.link_gravacao}`);
    if (r.link_transcricao) links.push(`Transcrição: ${r.link_transcricao}`);
    if (r.link_anotacao) links.push(`Anotações online: ${r.link_anotacao}`);
    if (r.ata_link_download) links.push(`Ata para download: ${r.ata_link_download}`);
    if (links.length > 0) {
      prompt += `Links:\n  ${links.join('\n  ')}\n`;
    }
    prompt += `\n`;
  }

  return prompt;
}

router.post('/', async (req: any, res: any) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages é obrigatório' });
    }

    const reunioes = await prisma.eppReunioesGovernanca.findMany({
      orderBy: { data_reuniao: 'desc' },
    });

    const systemPrompt = buildSystemPrompt(reunioes);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error('Erro no endpoint de chat:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro ao processar chat' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Erro ao processar resposta' })}\n\n`);
      res.end();
    }
  }
});

export default router;
