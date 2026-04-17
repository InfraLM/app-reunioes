export interface Usuario {
  id: string;
  nome: string;
  login: string;
  cargo?: string;
}

export interface AuthContextType {
  user: Usuario | null;
  token: string | null;
  login: (login: string, senha: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

export interface Reuniao {
  id: string;
  conference_id: string;
  data_reuniao: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  responsavel: string | null;
  titulo_reuniao: string | null;
  participantes_nomes: string | null;
  participantes_areas: string | null;
  objetivo_reuniao: string | null;
  link_gravacao: string | null;
  link_transcricao: string | null;
  link_anotacao: string | null;
  ata_link_download: string | null;
  itens_pauta_titulos: string | null;
  itens_pauta_completo: string | null;
  deliberacoes_titulos: string | null;
  deliberacoes_decisoes: string | null;
  acoes_lista: string | null;
  acoes_responsaveis: string | null;
  proximas_etapas: string | null;
  resumo_executivo: string | null;
}

export interface ConferenceStatus {
  id: string;
  startTime: number;
  timeoutTime: number;
  artifacts: {
    recording: boolean;
    transcript: boolean;
    smartNote: boolean;
  };
  status: 'waiting' | 'processing' | 'complete' | 'ignored' | 'error';
  userEmail: string;
  progress: string;
  logs: string[];
}

export interface SubscriptionStats {
  total: number;
  successful: number;
  failed: number;
  deleted?: number;
}

// Workspace Events API — status de inscrição por usuário monitorado
export interface UserSubscriptionStatus {
  email: string;
  user_id?: string | null;
  status: 'connected' | 'disconnected' | 'error';
  subscription_count: number;
  subscription_names: string[];
  error_message?: string;
  last_updated?: string;
}

export interface SubscriptionsStatusResponse {
  topic: string;
  total: number;
  summary: {
    connected: number;
    disconnected: number;
    error: number;
  };
  users: UserSubscriptionStatus[];
}

// ============================================================
// Novo fluxo: epp_meet_status + governanca
// ============================================================
export type MeetLifecycleStatus =
  | 'artefatos_faltantes'
  | 'artefatos_completos'
  | 'webhook_enfileirado'
  | 'webhook_enviando'
  | 'webhook_enviado'
  | 'webhook_erro'
  | 'ata_gerada'
  | 'ignorado';

export interface MeetStatus {
  conference_id: string;
  status: MeetLifecycleStatus;
  user_email: string;
  user_id: string | null;
  meeting_title: string | null;
  meet_space_id: string | null;
  meeting_start_time: string | null;
  meeting_end_time: string | null;

  has_recording: boolean;
  has_transcript: boolean;
  has_smart_note: boolean;

  data_primeiro_artefato: string | null;
  data_ultimo_artefato: string | null;
  data_artefatos_completos: string | null;
  data_ata_gerada: string | null;
  data_webhook_enfileirado: string | null;
  data_webhook_enviado: string | null;
  data_ultimo_erro: string | null;

  webhook_scheduled_for: string | null;
  webhook_attempt_count: number;
  webhook_last_status_code: number | null;
  webhook_last_error: string | null;

  queued_by: string | null;
  notes: string | null;

  created_at: string;
  updated_at: string;

  // Campos enriquecidos pelo endpoint
  drive_folder_link: string | null;
  recording_drive_link: string | null;
  transcript_drive_link: string | null;
  smart_note_drive_link: string | null;
  recording_original_link: string | null;
  transcript_original_link: string | null;
  smart_note_original_link: string | null;
  governanca: Reuniao | null;
  has_ata: boolean;
}

export interface MeetingsStatusResponse {
  total: number;
  summary: Partial<Record<MeetLifecycleStatus, number>>;
  meetings: MeetStatus[];
}

export interface QueueWebhookResult {
  conference_id: string;
  status: 'ok' | 'error';
  scheduled_for?: string;
  delay_seconds?: number;
  qstash_msg_id?: string;
  message?: string;
}

export interface QueueWebhookResponse {
  summary: { total: number; ok: number; error: number; gap_seconds: number };
  results: QueueWebhookResult[];
}

// ============================================================
// Recentes (180min tracking) + Ao Vivo (started sem ended)
// ============================================================
export interface RecentMeeting {
  conference_id: string;
  user_email: string;
  meeting_title: string | null;
  meeting_start_time: string | null;
  first_event_at: string;
  last_event_at: string;
  expires_at: string;
  minutes_remaining: number;

  has_started: boolean;
  has_ended: boolean;
  has_recording: boolean;
  has_transcript: boolean;
  has_smart_note: boolean;

  drive_folder_link: string | null;
  recording_link: string | null;
  transcript_link: string | null;
  smart_note_link: string | null;

  lifecycle_status: MeetLifecycleStatus | null;
}

export interface UserPasta {
  user_email: string;
  pasta_origem: string | null;
  pasta_destino: string | null;
}

export interface LiveMeeting {
  conference_id: string;
  user_email: string;
  meeting_title: string | null;
  started_at: string;
  duration_minutes: number;
  drive_folder_link: string | null;
  has_recording: boolean;
  has_transcript: boolean;
  has_smart_note: boolean;
}
