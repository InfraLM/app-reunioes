# Webhook de Recepção do Pub/Sub Push

Este diretório contém o endpoint que recebe eventos do Google Cloud Pub/Sub no modo **Push Subscription**.

## Como Funciona o Pub/Sub Push

No modo Push, o Google Cloud Pub/Sub faz uma requisição `POST` HTTP para a URL do endpoint configurada sempre que uma nova mensagem é publicada no tópico. Isso é diferente do modo Pull, onde a aplicação precisa ficar pedindo mensagens ativamente.

**Configuração necessária no Google Cloud Console:**
- Criar um tópico Pub/Sub (ex: `meet-events-topic`).
- Criar uma Push Subscription apontando para a URL do endpoint: `https://seu-dominio.vercel.app/api/webhooks/google-events`.
- A URL deve ser verificada pelo Google (HTTPS obrigatório, domínio registrado no Google Cloud).

---

## `google-events.js` - Endpoint Principal

**Rota**: `POST /api/webhooks/google-events`

**Estrutura do payload recebido do Pub/Sub:**
```json
{
  "message": {
    "data": "<base64 do payload do evento>",
    "attributes": {
      "ce-type": "google.workspace.meet.recording.v2.fileGenerated",
      "ce-subject": "//cloudidentity.googleapis.com/users/123456789",
      "ce-time": "2024-01-01T10:00:00Z"
    },
    "messageId": "...",
    "publishTime": "..."
  },
  "subscription": "projects/.../subscriptions/..."
}
```

**Payload decodificado (base64 → JSON) para evento de gravação:**
```json
{
  "recording": {
    "name": "conferenceRecords/abc123/recordings/xyz456",
    "driveDestination": {
      "file": "drive_file_id",
      "exportUri": "https://drive.google.com/file/d/.../view"
    },
    "state": "FILE_GENERATED"
  }
}
```

**Payload decodificado para evento de transcrição:**
```json
{
  "transcript": {
    "name": "conferenceRecords/abc123/transcripts/xyz456",
    "docsDestination": {
      "document": "docs_document_id",
      "exportUri": "https://docs.google.com/document/d/.../edit"
    },
    "state": "FILE_GENERATED"
  }
}
```

**Payload decodificado para evento de Smart Notes:**
```json
{
  "smartNote": {
    "name": "conferenceRecords/abc123/smartNotes/xyz456",
    "docsDestination": {
      "document": "docs_document_id",
      "exportUri": "https://docs.google.com/document/d/.../view"
    },
    "state": "FILE_GENERATED"
  }
}
```

---

## Lógica de Extração de URLs

O endpoint extrai as URLs diretamente do payload do evento, sem precisar fazer chamadas adicionais à API do Meet:

| Tipo de Artefato | Campo no Payload | Descrição |
|---|---|---|
| Gravação | `recording.driveDestination.exportUri` | Link direto para o MP4 no Google Drive |
| Transcrição | `transcript.docsDestination.exportUri` | Link direto para o Google Docs |
| Smart Notes | `smartNote.docsDestination.exportUri` | Link direto para o Google Docs |
| Smart Notes (fallback) | `smartNote.docsDestination.document` | ID do documento (montar URL manualmente) |

**Nota sobre Smart Notes**: O campo `exportUri` pode não estar presente em todos os eventos de Smart Notes. O fallback para o campo `document` (ID) é necessário. Para construir a URL de visualização: `https://docs.google.com/document/d/{document}/view`.

---

## Resposta ao Pub/Sub

**Importante**: O endpoint **sempre deve retornar um status 2xx** (200, 201, etc.) para confirmar o recebimento da mensagem. Se retornar um status de erro (4xx, 5xx), o Pub/Sub irá reenviar a mensagem automaticamente usando backoff exponencial, o que pode causar processamento duplicado.

Em caso de erro interno, o código retorna `200 OK` com um JSON de erro para evitar retentativas desnecessárias:
```json
{ "error": "Failed to process event, but acknowledging to prevent retries." }
```

---

## Rastreamento no Banco de Dados

Após processar o evento, o estado é salvo/atualizado na tabela `ConferenceArtifactTracking` (Prisma):

| Campo | Descrição |
|---|---|
| `conference_id` | ID único da conferência (ex: `conferenceRecords/abc123`) |
| `user_email` | E-mail do organizador (resolvido via Admin SDK) |
| `has_recording` | Boolean: gravação recebida? |
| `has_transcript` | Boolean: transcrição recebida? |
| `has_smart_note` | Boolean: anotações recebidas? |
| `recording_url` | URL direta da gravação |
| `transcript_url` | URL direta da transcrição |
| `smart_note_url` | URL direta das anotações |
| `timeout_at` | Quando o timer de 100 minutos expira |
| `status` | `no_artifact`, `waiting`, `processing`, `complete`, `partial_complete`, `error` |
