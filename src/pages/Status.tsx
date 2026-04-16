import { useEffect, useState, useCallback } from 'react';
import { subscriptionsService } from '../lib/api';
import type { SubscriptionsStatusResponse, UserSubscriptionStatus } from '../types';

type RowAction = 'idle' | 'loading' | 'success' | 'error';

export default function StatusPage() {
  const [data, setData] = useState<SubscriptionsStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [globalBusy, setGlobalBusy] = useState(false);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, { action: RowAction; msg?: string }>>({});

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await subscriptionsService.status();
      setData(res);
    } catch (e) {
      const msg = (e as Error & { response?: { data?: { message?: string } } }).response?.data?.message
        || (e as Error).message;
      setGlobalMessage(`Falha ao buscar status: ${msg}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const setRow = (email: string, action: RowAction, msg?: string) => {
    setRowStates((prev) => ({ ...prev, [email]: { action, msg } }));
  };

  const handleAction = async (email: string, kind: 'connect' | 'disconnect' | 'reconnect') => {
    setRow(email, 'loading');
    try {
      await subscriptionsService[kind](email);
      setRow(email, 'success', 'Feito');
      await load(false);
      setTimeout(() => setRow(email, 'idle'), 2000);
    } catch (e) {
      const err = e as Error & {
        response?: { data?: { message?: string; error?: string; details?: unknown } };
      };
      const data = err.response?.data;
      const msg = data?.message || data?.error || err.message;
      // Logar detalhes completos no console para debug
      console.error(`[${kind}] ${email}:`, data || err);
      setRow(email, 'error', msg);
    }
  };

  const handleReconnectAll = async () => {
    if (!confirm('Isso vai desconectar e reconectar TODOS os usuários monitorados. Continuar?')) return;
    setGlobalBusy(true);
    setGlobalMessage(null);
    try {
      const res = await subscriptionsService.reconnectAll();
      setGlobalMessage(`Concluído: ${res.summary.ok} ok, ${res.summary.error} erros`);
      await load(false);
    } catch (e) {
      const msg = (e as Error & { response?: { data?: { message?: string } } }).response?.data?.message
        || (e as Error).message;
      setGlobalMessage(`Falha: ${msg}`);
    } finally {
      setGlobalBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-white">Status das Inscrições</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Controle quais usuários monitorados estão inscritos no tópico Pub/Sub do Meet
          </p>
          {data?.topic && (
            <p className="text-zinc-600 text-xs mt-2 font-mono">Tópico: {data.topic}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => load(false)}
            disabled={refreshing || globalBusy}
            className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
          >
            {refreshing && <Spinner />}
            Atualizar
          </button>
          <button
            onClick={handleReconnectAll}
            disabled={globalBusy || refreshing}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-xl px-4 py-2.5 text-sm font-bold transition-all"
          >
            {globalBusy && <Spinner dark />}
            Reconectar todos
          </button>
        </div>
      </header>

      {globalMessage && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-300">
          {globalMessage}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Conectados" value={data.summary.connected} color="text-emerald-400" />
          <StatCard label="Desconectados" value={data.summary.disconnected} color="text-zinc-400" />
          <StatCard label="Com erro" value={data.summary.error} color="text-red-400" />
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950 border-b border-zinc-800">
            <tr>
              <th className="text-left px-4 py-3 text-zinc-500 font-semibold text-xs uppercase tracking-wide">Email</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-semibold text-xs uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-semibold text-xs uppercase tracking-wide">Subs</th>
              <th className="text-right px-4 py-3 text-zinc-500 font-semibold text-xs uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => {
              const state = rowStates[u.email] || { action: 'idle' as RowAction };
              return (
                <tr key={u.email} className="border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-white font-medium">
                    {u.email}
                    {u.error_message && (
                      <p className="text-red-400 text-xs mt-1">{u.error_message}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {u.subscription_count}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <RowActions user={u} state={state} onAction={handleAction} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {data?.users.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-zinc-500 py-8">
                  Nenhum usuário em MONITORED_USERS
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Spinner({ dark }: { dark?: boolean }) {
  return (
    <span
      className={`w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin ${
        dark ? 'border-black' : 'border-red-600'
      }`}
    />
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-zinc-500 text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function StatusChip({ status }: { status: UserSubscriptionStatus['status'] }) {
  const cfg = {
    connected: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'Conectado' },
    disconnected: { bg: 'bg-zinc-700/30', border: 'border-zinc-600/40', text: 'text-zinc-400', label: 'Desconectado' },
    error: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', label: 'Erro' },
  }[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-semibold ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function RowActions({
  user,
  state,
  onAction,
}: {
  user: UserSubscriptionStatus;
  state: { action: RowAction; msg?: string };
  onAction: (email: string, kind: 'connect' | 'disconnect' | 'reconnect') => void;
}) {
  const disabled = state.action === 'loading';

  const btnBase = 'text-xs font-semibold rounded-lg px-3 py-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5';
  const btnPrimary = `${btnBase} bg-red-600 hover:bg-red-500 text-white`;
  const btnSecondary = `${btnBase} bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700`;
  const btnDanger = `${btnBase} bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30`;

  if (state.action === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-400 max-w-xs truncate" title={state.msg}>
          {state.msg}
        </span>
        <button onClick={() => onAction(user.email, user.status === 'connected' ? 'reconnect' : 'connect')} className={btnSecondary}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (user.status === 'connected') {
    return (
      <>
        <button onClick={() => onAction(user.email, 'reconnect')} disabled={disabled} className={btnPrimary}>
          {state.action === 'loading' && <Spinner dark />}
          Reconectar
        </button>
        <button onClick={() => onAction(user.email, 'disconnect')} disabled={disabled} className={btnDanger}>
          Desconectar
        </button>
      </>
    );
  }

  if (user.status === 'disconnected') {
    return (
      <button onClick={() => onAction(user.email, 'connect')} disabled={disabled} className={btnPrimary}>
        {state.action === 'loading' && <Spinner dark />}
        Conectar
      </button>
    );
  }

  // error
  return (
    <button onClick={() => onAction(user.email, 'connect')} disabled={disabled} className={btnSecondary}>
      {state.action === 'loading' && <Spinner />}
      Tentar conectar
    </button>
  );
}
