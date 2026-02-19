import { useState, useEffect } from 'react';
import type { ConferenceStatus } from '../../types';
import { monitorService } from '../../lib/api';

interface Props {
  conference: ConferenceStatus;
  onRefresh: () => void;
  removeAt?: number;
}

const statusConfig = {
  waiting: { label: 'Aguardando', bg: 'bg-yellow-950/60', text: 'text-yellow-400', dot: 'bg-yellow-400', border: 'border-yellow-800/60' },
  processing: { label: 'Processando', bg: 'bg-blue-950/60', text: 'text-blue-400', dot: 'bg-blue-400', border: 'border-blue-800/60' },
  complete: { label: 'Concluído', bg: 'bg-green-950/60', text: 'text-green-400', dot: 'bg-green-400', border: 'border-green-800/60' },
  error: { label: 'Erro', bg: 'bg-red-950/60', text: 'text-red-400', dot: 'bg-red-400', border: 'border-red-800/60' },
  ignored: { label: 'Ignorado', bg: 'bg-zinc-900', text: 'text-zinc-500', dot: 'bg-zinc-500', border: 'border-zinc-700' },
};

function ArtifactDot({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${done ? 'bg-green-400 shadow-sm shadow-green-400/50' : 'bg-zinc-800'}`} />
      <span className={`text-xs font-medium transition-colors ${done ? 'text-zinc-300' : 'text-zinc-600'}`}>{label}</span>
    </div>
  );
}

export default function ConferenceRow({ conference, onRefresh, removeAt }: Props) {
  const [sending, setSending] = useState(false);
  const [timeLeft, setTimeLeft] = useState('--:--');
  const [removeIn, setRemoveIn] = useState<string | null>(null);

  useEffect(() => {
    if (!removeAt) { setRemoveIn(null); return; }
    const tick = () => {
      const left = removeAt - Date.now();
      if (left <= 0) { setRemoveIn(null); return; }
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      setRemoveIn(`${m}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [removeAt]);

  useEffect(() => {
    if (conference.status === 'waiting') {
      const interval = setInterval(() => {
        const left = conference.timeoutTime - Date.now();
        if (left <= 0) {
          setTimeLeft('TIMEOUT');
        } else {
          const minutes = Math.floor(left / 60000);
          const seconds = Math.floor((left % 60000) / 1000);
          setTimeLeft(
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
          );
        }
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setTimeLeft('--:--');
    }
  }, [conference.status, conference.timeoutTime]);

  const handleSendWebhook = async () => {
    setSending(true);
    try {
      await monitorService.enviarWebhook(conference.id);
      alert('Webhook disparado com sucesso!');
      onRefresh();
    } catch {
      alert('Erro ao enviar webhook');
    } finally {
      setSending(false);
    }
  };

  const isTimeout = timeLeft === 'TIMEOUT';
  const isUrgent =
    conference.status === 'waiting' &&
    !isTimeout &&
    conference.timeoutTime - Date.now() < 60000;

  const status = statusConfig[conference.status] ?? statusConfig.ignored;

  return (
    <tr className={`border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-all duration-150 group ${removeIn ? 'opacity-50' : ''}`}>

      {/* Conferência & organizador */}
      <td className="px-7 py-5">
        <p className="font-mono text-yellow-400 text-xs font-bold truncate max-w-[220px] mb-2">
          {conference.id}
        </p>
        <p className="text-white text-sm font-medium mb-1.5">{conference.userEmail || 'Desconhecido'}</p>
        <p className="text-zinc-600 text-xs font-normal">
          {new Date(conference.startTime).toLocaleTimeString('pt-BR')}
        </p>
      </td>

      {/* Artefatos */}
      <td className="px-7 py-5 w-[200px]">
        <div className="space-y-3">
          <ArtifactDot done={!!conference.artifacts.recording} label="Gravação" />
          <ArtifactDot done={!!conference.artifacts.transcript} label="Transcrição" />
          <ArtifactDot done={!!conference.artifacts.smartNote} label="Anotações" />
        </div>
      </td>

      {/* Countdown */}
      <td className="px-7 py-5">
        <span
          className={`font-mono font-black text-2xl tabular-nums tracking-tight ${isTimeout
              ? 'text-zinc-700'
              : isUrgent
                ? 'text-red-400'
                : conference.status === 'waiting'
                  ? 'text-white'
                  : 'text-zinc-700'
            }`}
        >
          {timeLeft}
        </span>
      </td>

      {/* Status + botão */}
      <td className="px-7 py-5">
        <span
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap ${status.bg} ${status.text} ${status.border}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status.dot}`} />
          {isTimeout && conference.status === 'waiting'
            ? 'Processando Parcial'
            : status.label}
        </span>

        {(conference.status === 'waiting' || conference.status === 'error') && (
          <button
            onClick={handleSendWebhook}
            disabled={sending}
            className="mt-3 flex items-center gap-2 px-5 py-2.5 bg-yellow-400 hover:bg-yellow-300 active:scale-[0.97] disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-black text-sm font-bold rounded-xl transition-all duration-150 cursor-pointer whitespace-nowrap select-none shadow-md shadow-yellow-400/10 hover:shadow-yellow-400/20"
          >
            {sending ? 'Enviando...' : 'Enviar Agora'}
          </button>
        )}

        {removeIn && (
          <div className="mt-2.5 flex items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 flex-shrink-0">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="text-zinc-600 text-[11px] font-mono">Removendo em {removeIn}</span>
          </div>
        )}
      </td>

      {/* Logs */}
      <td className="px-7 py-5 w-[180px] max-w-[180px]">
        <div className="bg-[#0a0a0a] border border-zinc-800/60 rounded-xl p-3.5 max-h-28 overflow-y-auto space-y-1.5">
          {conference.logs
            .slice(-5)
            .reverse()
            .map((log, i) => (
              <p key={i} className="text-xs font-mono text-zinc-600 leading-relaxed">
                {log}
              </p>
            ))}
        </div>
      </td>
    </tr>
  );
}
