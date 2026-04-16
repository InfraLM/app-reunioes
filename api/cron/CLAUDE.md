# Worker de Processamento de Eventos

Este diretório contém o worker que processa o log de eventos do Pub/Sub e avança o workflow das reuniões.

## `process-events.js` — Worker Principal

**Rota**: `POST /api/cron/process-events` (protegido por `Bearer CRON_SECRET`)

**Modos:**
1. **Específico**: body `{ conference_id: "..." }` processa apenas aquela meet
2. **Varredura**: sem body, busca até 5 meets com `status IN ('pending','processing')` ou eventos sem `meet_process` correspondente

---

## Workflow por reunião

Para cada `conference_id`:

1. **Ler eventos** de `lovable.epp_evento_track` (só eventos `is_monitored=true`)
2. **Agregar** flags (`has_recording`, `has_transcript`, `has_smart_note`), links originais e metadados do usuário
3. **UPSERT** em `lovable.epp_meet_process` (marca `status='processing'` para lock simples)
4. **Buscar metadados** da conferência via Meet API (`getConferenceDetails`) — apenas 1x
5. **Garantir pasta no Drive**:
   - Raiz: `GOOGLE_SHARED_DRIVE_FOLDER_ID`
   - Pasta do usuário: acha por nome (email) ou cria
   - Pasta da meet: acha por nome (conference_id) ou cria
6. **Copiar artefatos** ainda não copiados (`*_copied_at IS NULL`):
   - Extrair fileId do link original (`extractFileIdFromDriveUrl`)
   - `copyFileToFolder` → grava `*_drive_file_id`, `*_drive_link`, `*_copied_at`
   - Em erro: grava `*_error` e continua (não bloqueia os outros)
7. **Finalizar**:
   - Se todos os 3 artefatos presentes e copiados → `status='complete'` + envia webhook n8n
   - Se passou 100 min do `first_event_at` e tudo disponível foi copiado → `status='partial'` + envia webhook
   - Caso contrário → mantém `pending`/`processing` para nova tentativa

---

## Acionadores

- **QStash**: o webhook `/api/webhooks/google-events` dispara uma mensagem QStash com 30s de delay sempre que recebe um evento monitorado
- **Vercel Cron** (opcional): pode ser configurado em `vercel.json` como fallback para pegar meets que ficaram presas

---

## Segurança

```js
const authHeader = req.headers.authorization;
if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

---

## Idempotência & Retry

- Cópias só acontecem se `*_copied_at IS NULL` — seguro rodar múltiplas vezes
- Erros por artefato são isolados (`recording_error`, etc)
- Webhook só é enviado uma vez (`webhook_sent = true`)
- Conflitos de deduplicação em `epp_evento_track` são tratados via UNIQUE em `pubsub_message_id`
