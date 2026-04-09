# Banco de Dados - Schema Prisma

Este diretório contém o schema do Prisma para o banco de dados PostgreSQL usado pelo ambiente serverless (Vercel).

## Conexão

O banco usa o adaptador `@prisma/adapter-pg` com pool de conexões (`pg.Pool`) configurado para **máximo de 1 conexão simultânea** (`max: 1`), ideal para funções serverless que criam e destroem conexões rapidamente.

O arquivo `lib/prisma.cjs` (na raiz do projeto) é o ponto de entrada do Prisma Client para todas as funções Vercel.

---

## Tabelas

### `apps_usuarios` (schema: `lovable`)
Tabela de usuários da aplicação web. Controla quem pode fazer login no painel de reuniões.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID | Identificador único |
| `login` | String | Nome de usuário para login |
| `senha` | String | Hash bcrypt da senha |
| `reuniao` | Boolean | Permissão de acesso ao módulo de reuniões |
| `cargo`, `area` | String | Dados do usuário |

**Nota**: O campo `reuniao: true` é obrigatório para que o usuário consiga fazer login via `/api/auth/login`.

---

### `epp_reunioes_governanca` (schema: `public`)
Tabela final de reuniões processadas. Contém todos os metadados e links dos artefatos.

| Campo | Tipo | Descrição |
|---|---|---|
| `conference_id` | String (unique) | ID da conferência do Google Meet |
| `titulo_reuniao` | String | Nome do espaço do Meet |
| `data_reuniao` | Date | Data da reunião |
| `hora_inicio` / `hora_fim` | String | Horários de início e fim |
| `responsavel` | String | E-mail do organizador |
| `link_gravacao` | String | URL do vídeo no Google Drive |
| `link_transcricao` | String | URL da transcrição no Google Docs |
| `link_anotacao` | String | URL das Smart Notes no Google Docs |
| `ata` | Text | Ata gerada por IA (opcional) |
| `participantes_nomes` | String | Lista de participantes (opcional) |

Esta tabela é populada pelo `api/cron/process-timeouts.js` e pelo `api/send-webhook/[conferenceId].js`.

---

### `epp_conference_artifact_tracking` (schema: `lovable`)
Tabela de rastreamento intermediário. Substitui o estado em memória do backend Node.js para o ambiente serverless.

| Campo | Tipo | Descrição |
|---|---|---|
| `conference_id` | String (unique) | ID da conferência |
| `user_email` | String | E-mail do organizador |
| `has_recording` | Boolean | Gravação recebida via evento? |
| `has_transcript` | Boolean | Transcrição recebida via evento? |
| `has_smart_note` | Boolean | Anotações recebidas via evento? |
| `recording_name` | String | Nome do recurso (ex: `conferenceRecords/.../recordings/...`) |
| `recording_url` | String | URL extraída do evento ou da API |
| `timeout_at` | DateTime | Quando o timer de 100 min expira |
| `status` | String | Estado atual da conferência |
| `processed_at` | DateTime | Quando foi finalizada |

**Ciclo de vida do `status`:**
```
no_artifact → waiting → processing → complete
                                   ↘ partial_complete
                                   ↘ error
```

- `no_artifact`: Evento de `conference.started` ou `conference.ended` recebido, mas nenhum artefato ainda.
- `waiting`: Primeiro artefato recebido, timer iniciado, aguardando os demais.
- `processing`: Em processo de envio do webhook (evita processamento duplo).
- `complete`: Todos os artefatos com URLs encontradas, webhook enviado.
- `partial_complete`: Timer expirou, webhook enviado com os artefatos disponíveis.
- `error`: Falha no processamento.

---

## Schemas do PostgreSQL

O banco usa dois schemas distintos:
- `lovable`: Tabelas de controle interno da aplicação (`apps_usuarios`, `epp_conference_artifact_tracking`).
- `public`: Tabelas de dados de negócio (`epp_reunioes_governanca`).

Isso é configurado no `schema.prisma` com `schemas = ["lovable", "public"]` e `@@schema("lovable")` / `@@schema("public")` em cada model.
