import { useState, useEffect, useCallback } from 'react';
import { monitorService } from '../lib/api';
import type { LiveMeeting } from '../types';

function formatResponsavel(raw: string | null): string {
  if (!raw) return 'Desconhecido';
  const local = raw.includes('@') ? raw.split('@')[0] : raw;
  return local
    .split('.')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function DurationBadge({ minutes }: { minutes: number }) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const isLong = minutes >= 120;
  const color = isLong
    ? 'text-amber-400 border-amber-800/60 bg-amber-950/40'
    : 'text-emerald-400 border-emerald-700/60 bg-emerald-950/40';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {label}
    </span>
  );
}

function LiveCard({ meeting }: { meeting: LiveMeeting }) {
  const [elapsed, setElapsed] = useState(meeting.duration_minutes);

  useEffect(() => {
    const id = setInterval(() => {
      const min = Math.round((Date.now() - new Date(meeting.started_at).getTime()) / 60000);
      setElapsed(min);
    }, 30000);
    return () => clearInterval(id);
  }, [meeting.started_at]);

  return (
    <div className="bg-[#111111] border border-emerald-700/40 hover:border-emerald-500/50 rounded-2xl overflow-hidden transition-all duration-200">
      <div className="px-5 py-4 border-b border-zinc-800/60 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-white font-bold text-sm leading-snug line-clamp-2">
            {meeting.meeting_title || 'Reunião do Google Meet'}
          </h3>
          <p className="text-zinc-500 text-xs mt-1 truncate">{formatResponsavel(meeting.user_email)}</p>
        </div>
        <DurationBadge minutes={elapsed} />
      </div>

      <div className="px-5 py-4 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Início</span>
          <span className="text-zinc-300 font-medium">
            {new Date(meeting.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Artefatos chegando</span>
          <div className="flex items-center gap-2">
            <Dot ok={meeting.has_recording} label="Grav." />
            <Dot ok={meeting.has_transcript} label="Trans." />
            <Dot ok={meeting.has_smart_note} label="Notes" />
          </div>
        </div>
      </div>

      {meeting.drive_folder_link && (
        <div className="px-5 py-3 border-t border-zinc-800/60">
          <a
            href={meeting.drive_folder_link}
            target="_blank"
            rel="noreferrer"
            className="text-red-500 hover:text-red-400 text-xs font-semibold transition-colors"
          >
            Pasta no Drive
          </a>
        </div>
      )}
    </div>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      title={label}
      className={`flex items-center gap-1 ${ok ? 'text-emerald-400' : 'text-zinc-700'}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
      <span className="text-[10px] font-medium">{label}</span>
    </span>
  );
}

export default function AoVivoPage() {
  const [meetings, setMeetings] = useState<LiveMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await monitorService.live();
      setMeetings(res.meetings || []);
      setConnected(true);
    } catch (e) {
      console.error('Erro ao carregar ao vivo:', e);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      <div className="flex justify-between items-start mb-10 gap-6">
        <div>
          <p className="text-xs font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">Tempo Real</p>
          <h1 className="text-3xl font-black text-white tracking-tight">Ao Vivo</h1>
          <p className="text-zinc-500 text-sm mt-2 font-normal">
            Reuniões em andamento — iniciadas mas sem evento de finalização.
          </p>
        </div>

        <div
          className={`flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-bold border whitespace-nowrap ${
            connected
              ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/60'
              : 'bg-red-950/50 text-red-400 border-red-800/60'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          {connected ? 'Conectado' : 'Desconectado'}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-28">
          <div className="w-6 h-6 border-2 border-red-600 border-t-transparent rounded-full animate-spin mb-5" />
          <p className="text-zinc-600 text-sm font-medium">Buscando reuniões ao vivo...</p>
        </div>
      ) : meetings.length === 0 ? (
        <div className="bg-[#111111] border border-zinc-800 rounded-2xl py-28 flex flex-col items-center justify-center">
          <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
          </div>
          <p className="text-white font-bold text-base mb-2">Nenhuma reunião ao vivo</p>
          <p className="text-zinc-600 text-sm text-center max-w-xs leading-relaxed font-normal">
            Quando um usuário monitorado iniciar uma reunião no Google Meet, ela aparecerá aqui.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {meetings.map((m) => (
            <LiveCard key={m.conference_id} meeting={m} />
          ))}
        </div>
      )}
    </div>
  );
}
