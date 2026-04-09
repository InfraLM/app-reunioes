# API Serverless Vercel - Webhooks e Banco de Dados

Este diretório contém a lógica serverless (deployada na Vercel) para escutar eventos do Google Meet e processar seus artefatos. Esta versão foi desenhada para executar rapidamente em ambiente serverless, salvar estado em banco de dados e encerrar o processo.

## Fluxo de Processamento (Serverless Push)

1. **Recepção do Webhook (`webhooks/google-events.js`)**:
   - O Google Cloud Pub/Sub envia um `POST` HTTP contendo o payload do evento (Push Subscription).
   - O endpoint extrai o ID da conferência (`conferenceRecords/xxx`), o tipo do evento (`recording`, `transcript`, `smartNote`) e a URL do artefato gerado.
   - O estado atual da conferência é persistido/atualizado na tabela `ConferenceArtifactTracking` do Prisma.
   - O status da reunião passa para `waiting` (aguardando mais artefatos) quando o primeiro artefato é recebido.
   - O tempo limite de **100 minutos** é salvo no banco (`timeout_at`).

2. **Timeout e Finalização (`cron/process-timeouts.js`)**:
   - Um Cron Job (atualmente via Vercel Cron) executa periodicamente para encontrar reuniões que passaram do tempo limite (`timeout_at <= NOW()`).
   - Se uma reunião já tem os 3 artefatos (ou se passou do timeout), a função `processTimedOutConference` agrupa os URLs, salva na tabela final `EppReunioesGovernanca` e envia o payload final para o Webhook de destino.
   - O status da conferência passa para `complete` ou `partial_complete`.

## Alternativa ao Vercel Cron (Plano Gratuito)

A aplicação utiliza **Upstash QStash** para agendar callbacks HTTP (Delayed Tasks) em vez de Vercel Cron Jobs pagos.

1. No momento em que o primeiro artefato chega (`webhooks/google-events.js`), a aplicação agenda uma mensagem no QStash para 100 minutos no futuro.
2. A Vercel "dorme" sem gastar recursos.
3. Após exatos 100 minutos, o QStash faz um POST para `/api/cron/process-timeouts` passando o `conference_id`.
4. O endpoint verifica no banco quais artefatos já chegaram, busca os faltantes na API do Meet, envia o webhook final e encerra a reunião.

Isso elimina a necessidade do Cron pago da Vercel e torna o sistema mais eficiente e barato.

## Google APIs em Ambiente Serverless

- **Autenticação**: O arquivo `api/lib/google.js` centraliza os clientes do Google. A autenticação usa Domain-Wide Delegation com `impersonatedEmail`. O tempo de vida do token é cacheado ou gerado sob demanda.
- **Limites de Tempo**: Funções Vercel (Hobby) têm limite de 10s (ou 30-60s em Pro). O webhook do Pub/Sub (`google-events.js`) apenas salva no banco e retorna `200 OK` imediatamente para não dar timeout na requisição do Google.
- **Retentativas**: Se o webhook falhar, o Pub/Sub do Google tenta novamente usando "Exponential Backoff" automaticamente.

## Arquivos Chave
- `webhooks/google-events.js`: Ponto de entrada do Pub/Sub.
- `cron/process-timeouts.js`: Verificador de timeouts e finalizador.
- `check-conferences.js` / `status.js`: Endpoints de debug para o painel frontend.
- `send-webhook/[conferenceId].js`: Permite forçar o envio manual de uma reunião pelo painel.
