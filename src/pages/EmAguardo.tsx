import { useCallback, useEffect, useState } from 'react';
import { monitorService } from '../lib/api';
import type { RecentMeeting } from '../types';

function formatResponsavel(raw: string | null): string {
  if (!raw) return 'Desconhecido';
  const local = raw.includes('@') ? raw.split('@')[0] : raw;
  return local
    .split('.')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function Checkbox({ checked, label, link }: { checked: boolean; label: string; link?: string | null }) {
  const content = (
    <div className="flex items-center gap-2.5 select-none">
      <span
        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all ${
          checked
            ? 'bg-emerald-600 border-emerald-500 text-white'
            : 'bg-zinc-900 border-zinc-700 text-transparent'
        }`}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span className={`text-sm font-medium ${checked ? 'text-zinc-200' : 'text-zinc-600'}`}>
        {label}
      </span>
    </div>
  );

  if (checked && link) {
    return (
      <a href={link} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity" title={`Abrir ${label} no Drive`}>
        {content}
      </a>
    );
  }
  return content;
}

function TimeBadge({ minutes }: { minutes: number }) {
  const isUrgent = minutes <= 30;
  const color = isUrgent ? 'text-red-400 border-red-800/60 bg-red-950/40' : 'text-zinc-400 border-zinc-700 bg-zinc-900';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const label = h > 0 ? `${h}h ${m}m restantes` : `${m}m restantes`;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-semibold ${color}`}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {label}
    </span>
  );
}

function RecentCard({ meeting }: { meeting: RecentMeeting }) {
  const allChecked = meeting.has_started && meeting.has_ended && meeting.has_recording && meeting.has_transcript && meeting.has_smart_note;
  const borderColor = allChecked
    ? 'border-emerald-700/50 hover:border-emerald-500/60'
    : meeting.has_ended
      ? 'border-amber-700/50 hover:border-amber-500/60'
      : 'border-zinc-800 hover:border-zinc-700';

  return (
    <div className={`bg-[#111111] border ${borderColor} rounded-2xl overflow-hidden transition-all duration-200`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800/60 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-white font-bold text-sm leading-snug line-clamp-2">
            {meeting.meeting_title || 'Reunião do Google Meet'}
          </h3>
          <p className="text-zinc-500 text-xs mt-1 truncate">{formatResponsavel(meeting.user_email)}</p>
        </div>
        <TimeBadge minutes={meeting.minutes_remaining} />
      </div>

      {/* Checkboxes */}
      <div className="px-5 py-4 space-y-3">
        <Checkbox checked={meeting.has_started} label="Reunião iniciada" />
        <Checkbox checked={meeting.has_ended} label="Reunião finalizada" />
        <Checkbox checked={meeting.has_recording} label="Gravação" link={meeting.recording_link} />
        <Checkbox checked={meeting.has_transcript} label="Transcrição" link={meeting.transcript_link} />
        <Checkbox checked={meeting.has_smart_note} label="Smart Notes" link={meeting.smart_note_link} />
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-600">
        <span>{new Date(meeting.first_event_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        {meeting.drive_folder_link && (
          <a
            href={meeting.drive_folder_link}
            target="_blank"
            rel="noreferrer"
            className="text-red-500 hover:text-red-400 font-semibold transition-colors"
          >
            Pasta no Drive
          </a>
        )}
      </div>
    </div>
  );
}

export default function RecentesPage() {
  const [meetings, setMeetings] = useState<RecentMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await monitorService.recent();
      setMeetings(res.meetings || []);
    } catch (e) {
      console.error('Erro ao carregar recentes:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), 15000);
    return () => clearInterval(id);
  }, [load]);

  const completas = meetings.filter((m) => m.has_started && m.has_ended && m.has_recording && m.has_transcript && m.has_smart_note);
  const parciais = meetings.filter((m) => !completas.includes(m));

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
          <p className="text-xs font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">Últimas 3 horas</p>
          <h1 className="text-3xl font-black text-white tracking-tight">Recentes</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Acompanhe os eventos de cada reunião em tempo real. Tracking de 180 minutos.
          </p>
        </div>
        <button
          onClick={() => load(false)}
          disabled={refreshing}
          className="bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 disabled:opacity-50 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
        >
          {refreshing ? 'Atualizando…' : 'Atualizar'}
        </button>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide">Total</p>
          <p className="text-3xl font-bold mt-1 text-white">{meetings.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide">Completas</p>
          <p className="text-3xl font-bold mt-1 text-emerald-400">{completas.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide">Parciais</p>
          <p className="text-3xl font-bold mt-1 text-amber-400">{parciais.length}</p>
        </div>
      </div>

      {meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p className="text-white font-bold text-base mb-2">Nenhuma reunião recente</p>
          <p className="text-zinc-600 text-sm max-w-[280px] leading-relaxed">
            Reuniões com eventos nas últimas 3 horas aparecerão aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {meetings.map((m) => (
            <RecentCard key={m.conference_id} meeting={m} />
          ))}
        </div>
      )}
    </div>
  );
}
