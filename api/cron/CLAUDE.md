# Cron de Processamento de Timeouts

Este diretório contém o endpoint que processa reuniões cujo timer de 100 minutos expirou.

## O Problema que Este Endpoint Resolve

Em ambiente serverless, não é possível usar `setTimeout` para agendar uma tarefa futura, pois a função morre após responder a requisição. A solução adotada é:

1. Salvar `timeout_at = NOW() + 100 minutos` no banco quando o primeiro artefato chega.
2. Ter um processo externo que periodicamente verifica se alguma conferência passou do `timeout_at`.
3. Quando encontrar, processar os artefatos disponíveis e enviar o webhook.

---

## `process-timeouts.js` - Endpoint de Processamento

**Rota**: `POST /api/cron/process-timeouts` (ou `GET`, dependendo do chamador)

**Modos de operação:**
1. **Específico (via QStash)**: Recebe `conference_id` no body e processa apenas a conferência alvo.
2. **Varredura (Fallback)**: Quando chamado sem body, busca as 5 conferências mais antigas com timeout expirado e processa.

---

## O Substituto do Vercel Cron: Upstash QStash

A aplicação utiliza [Upstash QStash](https://upstash.com/docs/qstash/overall/getstarted), um serviço de fila de mensagens com delay, para agendar a execução deste endpoint exatamente 100 minutos após a chegada do primeiro artefato.

**Vantagens:**
- Tier gratuito generoso.
- Integração nativa com Vercel (sem necessidade de plano pago para crons frequentes).
- O endpoint processa apenas a conferência específica, economizando recursos.

**Como funciona:**
1. Em `api/webhooks/google-events.js`, a função `scheduleTimeoutViaQStash` é chamada com `delay=100m`.
2. Após 100 minutos, o QStash faz um POST para `/api/cron/process-timeouts` enviando `{ "conference_id": "..." }` no body.
3. O endpoint verifica o banco, busca os artefatos faltantes via API do Meet e finaliza a reunião.

O endpoint também suporta **varredura geral** (quando chamado sem `conference_id` no body), útil para recuperação de falhas manuais.

---

## Lógica de `processTimedOutConference(tracking)`

Para cada conferência com timeout expirado:

1. **Busca detalhes da conferência** via `getConferenceDetails()` (Meet API).
2. **Tenta obter URLs** dos artefatos que chegaram:
   - Primeiro tenta usar a URL já salva no banco (`tracking.recording_url`, etc.).
   - Se não tiver, faz uma chamada à API do Meet para buscar os detalhes do artefato.
3. **Persiste as URLs** encontradas no banco (para evitar buscas repetidas).
4. **Monta o payload** com os artefatos disponíveis, marcando `partial: true` se nem todos chegaram.
5. **Envia o webhook** se houver pelo menos 1 artefato.
6. **Salva a reunião** na tabela `EppReunioesGovernanca` via Prisma (upsert).
7. **Atualiza o status** para `complete` ou `partial_complete`.

---

## Segurança do Endpoint

O endpoint verifica um token de autorização para evitar chamadas não autorizadas:
```javascript
const authHeader = req.headers.authorization;
if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

Configure `CRON_SECRET` nas variáveis de ambiente da Vercel e no chamador (Vercel Cron, QStash, etc.).
