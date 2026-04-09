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
