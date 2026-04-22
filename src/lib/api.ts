import axios from 'axios';
import type { Reuniao } from '../types';

const API_URL = '/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor: adicionar token automaticamente
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor: tratar erro 401 (não autorizado)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expirado ou inválido
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// Serviço de autenticação
export const authService = {
  login: async (login: string, senha: string) => {
    const response = await api.post('/auth/login', { login, senha });
    return response.data;
  },
};

// Serviço de reuniões
export const reunioesService = {
  listar: async (filters?: {
    data_inicio?: string;
    data_fim?: string;
    responsavel?: string;
    limit?: number;
    offset?: number;
  }) => {
    const response = await api.get('/reunioes', { params: filters });
    return response.data;
  },
  buscar: async (id: string): Promise<Reuniao> => {
    const response = await api.get(`/reunioes/${id}`);
    return response.data;
  },
};

// Serviço de monitoramento (sem autenticação — legado)
export const monitorService = {
  status: async () => {
    const response = await axios.get('/api/status');
    return response.data;
  },
  enviarWebhook: async (conferenceId: string) => {
    const response = await axios.post(`/api/send-webhook/${conferenceId}`);
    return response.data;
  },
  recent: async () => {
    const response = await api.get('/meetings/recent');
    return response.data;
  },
  live: async () => {
    const response = await api.get('/meetings/live');
    return response.data;
  },
};

// Serviço do novo fluxo de meetings (status + fila de processamento de atas)
export const meetingsService = {
  list: async (filter: 'todos' | 'em_aguardo' | 'ata_gerada' = 'todos') => {
    const response = await api.get('/meetings/status', { params: { filter } });
    return response.data;
  },
  enqueueAta: async (conferenceIds: string[]) => {
    const response = await api.post('/meetings/enqueue-ata', {
      conference_ids: conferenceIds,
    });
    return response.data;
  },
  retryAta: async (conferenceId: string) => {
    const response = await api.post('/meetings/retry-ata', {
      conference_id: conferenceId,
    });
    return response.data;
  },
};

// Serviço de progresso de geração de ata (Processamento)
export const ataService = {
  progress: async () => {
    const response = await api.get('/ata/progress');
    return response.data;
  },
};

// Serviço de estatísticas (Home)
export const statsService = {
  dashboard: async () => {
    const response = await api.get('/stats/dashboard');
    return response.data;
  },
};

// Serviço de user_pastas (admin)
export const userPastasService = {
  list: async () => {
    const response = await api.get('/admin/user-pastas');
    return response.data;
  },
  update: async (user_email: string, data: { pasta_origem?: string | null; pasta_destino?: string | null }) => {
    const response = await api.patch('/admin/user-pastas', { user_email, ...data });
    return response.data;
  },
};

// Serviço de inscrições no Pub/Sub (Workspace Events API)
export const subscriptionsService = {
  status: async () => {
    const response = await api.get('/subscriptions/status');
    return response.data;
  },
  connect: async (email: string) => {
    const response = await api.post('/subscriptions/connect', { email });
    return response.data;
  },
  disconnect: async (email: string) => {
    const response = await api.post('/subscriptions/disconnect', { email });
    return response.data;
  },
  reconnect: async (email: string) => {
    const response = await api.post('/subscriptions/reconnect', { email });
    return response.data;
  },
  reconnectAll: async () => {
    const response = await api.post('/subscriptions/reconnect-all');
    return response.data;
  },
};
