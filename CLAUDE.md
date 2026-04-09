# App Reuniões Governança - Documentação Técnica

Este repositório contém a aplicação de rastreamento e processamento de reuniões do Google Meet para a governança.

## Arquitetura Atual: Serverless (Vercel)

A aplicação foi consolidada para rodar **exclusivamente em ambiente Serverless (Vercel)**, eliminando a necessidade de um backend Node.js contínuo. Isso reduz custos, zera a manutenção de infraestrutura e garante resiliência (o estado sobrevive a qualquer reinicialização).

### Componentes Principais

1. **Frontend (React + Vite)**:
   - Fica na pasta `src/`.
   - Compilado via `vite build` e servido estaticamente pela Vercel.
   - Faz requisições para a API em `/api/*`.

2. **API Serverless (`api/`)**:
   - Funções Vercel (Node.js) que processam webhooks, autenticação, cron e chamadas do frontend.
   - Utiliza a pasta `api/lib/` para compartilhar clientes das APIs do Google, logger e configurações.

3. **Banco de Dados (PostgreSQL + Prisma)**:
   - O estado de todas as conferências é persistido no banco de dados (`ConferenceArtifactTracking`).
   - Garante que nenhuma reunião em andamento seja perdida se a função Vercel morrer.

---

## Fluxo de Rastreamento de Artefatos

O objetivo central do app é rastrear a chegada de 3 artefatos do Google Meet (Gravação, Transcrição, Smart Notes) e disparar um webhook com os links quando todos chegam ou quando um timer expira.

1. **Google Workspace Events API**:
   - O Workspace foi configurado para enviar eventos de `fileGenerated` para um tópico do Google Cloud Pub/Sub.

2. **Pub/Sub Push Subscription**:
   - O Pub/Sub faz um `POST` automático para o endpoint `/api/webhooks/google-events`.
   - O endpoint extrai o ID da conferência, o e-mail do organizador e a URL do artefato que acabou de chegar.

3. **O Timer de 100 Minutos (Upstash QStash)**:
   - Quando o **primeiro artefato** de uma reunião chega, a API agenda uma chamada HTTP para daqui a 100 minutos usando o **Upstash QStash**.
   - O registro no banco muda para o status `waiting`.

4. **O Callback do Timeout (`/api/cron/process-timeouts`)**:
   - Exatamente 100 minutos depois, o QStash faz um POST para o endpoint de timeout passando o `conference_id`.
   - O endpoint verifica no banco quais artefatos já chegaram. Se faltar algum, faz uma busca proativa na API do Meet (caso o evento do Pub/Sub tenha falhado).
   - Monta o payload final, envia para o `WEBHOOK_DESTINATION_URL` e salva a reunião finalizada na tabela `EppReunioesGovernanca`.

---

## Pastas Estratégicas e Suas Documentações

Para entender a fundo cada parte do sistema, leia os arquivos `CLAUDE.md` específicos em cada diretório:

- [`api/CLAUDE.md`](./api/CLAUDE.md) - Visão geral das funções serverless e da biblioteca compartilhada (`api/lib/`).
- [`api/webhooks/CLAUDE.md`](./api/webhooks/CLAUDE.md) - Como o Pub/Sub Push funciona e como os URLs são extraídos dos eventos.
- [`api/cron/CLAUDE.md`](./api/cron/CLAUDE.md) - Como funciona o agendamento de timeout via QStash e a varredura de fallback.
- [`prisma/CLAUDE.md`](./prisma/CLAUDE.md) - Estrutura das tabelas do banco de dados e ciclo de vida dos status de processamento.

---

## Como Rodar Localmente

1. Clone o repositório e instale as dependências:
   ```bash
   npm install
   ```

2. Configure o arquivo `.env` (use o `.env.example` como base).

3. Gere o cliente Prisma:
   ```bash
   npx prisma generate
   ```

4. Inicie o servidor de desenvolvimento usando o Vercel CLI (recomendado, pois simula o ambiente serverless):
   ```bash
   vercel dev
   ```
   *O comando `npm run dev` (Vite) também funciona, mas não servirá as rotas da pasta `api/` nativamente sem proxy.*
