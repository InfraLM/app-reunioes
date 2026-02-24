import { useState, useEffect } from 'react';
import { monitorService } from '../lib/api';
import type { ConferenceStatus, SubscriptionStats } from '../types';
import ConferenceRow from '../components/Processamento/ConferenceRow';

const REMOVE_DELAY = 5 * 60 * 1000; // 5 minutos após webhook enviado

export default function ProcessamentoPage() {
  const [conferences, setConferences] = useState<ConferenceStatus[]>([]);
  const [completedAt, setCompletedAt] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem('meetgov_completedAt');
      if (!stored) return {};
      const data: Record<string, number> = JSON.parse(stored);
      // Descarta entradas já expiradas para não acumular lixo no localStorage
      const now = Date.now();
      return Object.fromEntries(Object.entries(data).filter(([, ts]) => now - ts < REMOVE_DELAY));
    } catch {
      return {};
    }
  });
  const [subscriptionStats, setSubscriptionStats] = useState<SubscriptionStats>({
    successful: 0,
    total: 0,
    failed: 0,
  });
  const [connected, setConnected] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await monitorService.status();
      const confs: ConferenceStatus[] = data.conferences || [];
      setConferences(confs);
      setSubscriptionStats(data.subscriptions || { successful: 0, total: 0, failed: 0 });
      setConnected(true);
      // Registra o momento em que cada conferência é detectada como concluída/ignorada
      setCompletedAt(prev => {
        const now = Date.now();
        // Remove entradas expiradas
        const next: Record<string, number> = Object.fromEntries(
          Object.entries(prev).filter(([, ts]) => now - ts < REMOVE_DELAY)
        );
        let changed = Object.keys(next).length !== Object.keys(prev).length;
        confs.forEach(conf => {
          if ((conf.status === 'complete' || conf.status === 'ignored') && !next[conf.id]) {
            next[conf.id] = now;
            changed = true;
          }
        });
        if (changed) {
          localStorage.setItem('meetgov_completedAt', JSON.stringify(next));
          return next;
        }
        return prev;
      });
    } catch (error) {
      setConnected(false);
      console.error('Erro ao buscar status:', error);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Polling a cada 10 segundos
    return () => clearInterval(interval);
  }, []);

  const isFullySubscribed =
    subscriptionStats.successful === subscriptionStats.total &&
    subscriptionStats.total > 0;

  // Filtra conferências que já passaram 5 min após o webhook ser enviado
  const visibleConferences = conferences
    .sort((a, b) => b.startTime - a.startTime)
    .filter(conf => {
      // Remove se completada/ignorada há mais de 5 min
      const ca = completedAt[conf.id];
      if (ca && Date.now() - ca >= REMOVE_DELAY) return false;
      // Remove se o timeout disparou há mais de 5 min e ainda está em 'waiting' (lag do backend)
      if (conf.status === 'waiting' && conf.timeoutTime + REMOVE_DELAY < Date.now()) return false;
      return true;
    });

  // Retorna quando a linha deve desaparecer (para exibir o countdown de remoção)
  const getRemoveAt = (conf: ConferenceStatus): number | undefined => {
    const ca = completedAt[conf.id];
    if (ca) return ca + REMOVE_DELAY;
    if (conf.status === 'waiting' && conf.timeoutTime < Date.now()) return conf.timeoutTime + REMOVE_DELAY;
    return undefined;
  };

  return (
    <div>
      {/* Page header */}
      <div className="flex justify-between items-start mb-10 gap-6">
        <div>
          <p className="text-xs font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">
            Tempo Real
          </p>
          <h1 className="text-3xl font-black text-white tracking-tight">
            Monitoramento de Reuniões
          </h1>
          <p className="text-zinc-500 text-sm mt-2 font-normal">
            Timeout automático em 100 minutos por conferência
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div
            className={`flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-bold border whitespace-nowrap ${isFullySubscribed
              ? 'bg-green-950/50 text-green-400 border-green-800/60'
              : 'bg-yellow-950/50 text-yellow-400 border-yellow-800/60'
              }`}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${isFullySubscribed ? 'bg-green-400' : 'bg-yellow-400'
                }`}
            />
            {subscriptionStats.successful}/{subscriptionStats.total} inscritos
          </div>

          <div
            className={`flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-bold border whitespace-nowrap ${connected
              ? 'bg-green-950/50 text-green-400 border-green-800/60'
              : 'bg-red-950/50 text-red-400 border-red-800/60'
              }`}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'
                }`}
            />
            {connected ? 'Conectado' : 'Desconectado'}
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-[#111111] border border-zinc-800 rounded-2xl overflow-hidden">
        {visibleConferences.length === 0 ? (
          <div className="py-28 flex flex-col items-center justify-center">
            <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-5">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#3f3f46"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </div>
            <p className="text-white font-bold text-base mb-2">Nenhuma reunião ativa</p>
            <p className="text-zinc-600 text-sm text-center max-w-xs leading-relaxed font-normal">
              Finalize uma gravação no Google Meet para ver o processamento em tempo real.
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-7 py-5 text-left text-xs font-bold text-zinc-600 uppercase tracking-[0.12em]">
                  Conferência & Organizador
                </th>
                <th className="px-7 py-5 text-left text-xs font-bold text-zinc-600 uppercase tracking-[0.12em] w-[200px]">
                  Artefatos
                </th>
                <th className="px-7 py-5 text-left text-xs font-bold text-zinc-600 uppercase tracking-[0.12em]">
                  Countdown
                </th>
                <th className="px-7 py-5 text-left text-xs font-bold text-zinc-600 uppercase tracking-[0.12em]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleConferences.map((conf) => (
                <ConferenceRow
                  key={conf.id}
                  conference={conf}
                  removeAt={getRemoveAt(conf)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
