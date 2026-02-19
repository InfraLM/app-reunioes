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

// URL do app cPanel (listener de assinaturas do Google Meet)
const CPANEL_URL = import.meta.env.VITE_CPANEL_URL || 'https://lmedu.com.br/reunioes';

// Serviço de monitoramento — aponta para o servidor cPanel
export const monitorService = {
  status: async () => {
    const response = await axios.get(`${CPANEL_URL}/health`);
    return response.data;
  },
  enviarWebhook: async (conferenceId: string) => {
    const response = await axios.post(`${CPANEL_URL}/api/send-webhook/${conferenceId}`);
    return response.data;
  },
};
