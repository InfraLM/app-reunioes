-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "lovable";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "lovable"."apps_usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT,
    "email" TEXT,
    "login" TEXT,
    "senha" TEXT,
    "cargo" TEXT,
    "ci" BOOLEAN DEFAULT false,
    "pfo" BOOLEAN DEFAULT false,
    "comercial" BOOLEAN DEFAULT false,
    "ronda" BOOLEAN DEFAULT false,
    "reuniao" BOOLEAN DEFAULT false,
    "data_criacao" DATE DEFAULT CURRENT_TIMESTAMP,
    "area" TEXT,

    CONSTRAINT "apps_usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epp_reunioes_governanca" (
    "id" TEXT NOT NULL,
    "conference_id" TEXT NOT NULL,
    "data_reuniao" DATE,
    "hora_inicio" TEXT,
    "hora_fim" TEXT,
    "responsavel" TEXT,
    "anotacao" TEXT,
    "transcricao" TEXT,
    "link_anotacao" TEXT,
    "link_transcricao" TEXT,
    "link_gravacao" TEXT,
    "ata" TEXT,
    "ata_pdf_link" TEXT,
    "ata_link_download" TEXT,
    "titulo_reuniao" TEXT,
    "local_meio" TEXT,
    "participantes_nomes" TEXT,
    "participantes_areas" TEXT,
    "objetivo_reuniao" TEXT,
    "itens_pauta_titulos" TEXT,
    "itens_pauta_completo" TEXT,
    "deliberacoes_titulos" TEXT,
    "deliberacoes_discussoes" TEXT,
    "deliberacoes_decisoes" TEXT,
    "acoes_lista" TEXT,
    "acoes_responsaveis" TEXT,
    "proximas_etapas" TEXT,
    "resumo_executivo" TEXT,

    CONSTRAINT "epp_reunioes_governanca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conference_artifact_tracking" (
    "id" TEXT NOT NULL,
    "conference_id" TEXT NOT NULL,
    "user_email" TEXT,
    "has_recording" BOOLEAN NOT NULL DEFAULT false,
    "has_transcript" BOOLEAN NOT NULL DEFAULT false,
    "has_smart_note" BOOLEAN NOT NULL DEFAULT false,
    "recording_name" TEXT,
    "transcript_name" TEXT,
    "smart_note_name" TEXT,
    "first_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeout_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conference_artifact_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "epp_reunioes_governanca_conference_id_key" ON "epp_reunioes_governanca"("conference_id");

-- CreateIndex
CREATE UNIQUE INDEX "conference_artifact_tracking_conference_id_key" ON "conference_artifact_tracking"("conference_id");

