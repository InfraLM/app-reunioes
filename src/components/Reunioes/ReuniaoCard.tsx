import type { MeetStatus, MeetLifecycleStatus } from '../../types';

interface Props {
  meeting: MeetStatus;
  onClick: () => void;
  onCreateAta?: () => void;
  actionLoading?: boolean;
}

type Theme = {
  border: string;
  bg: string;
  hoverBorder: string;
  chipBg: string;
  chipText: string;
  chipBorder: string;
  dot: string;
  label: string;
};

const THEMES: Record<MeetLifecycleStatus, Theme> = {
  ata_gerada: {
    border: 'border-emerald-700/50',
    bg: 'bg-emerald-950/20',
    hoverBorder: 'hover:border-emerald-500/60',
    chipBg: 'bg-emerald-500/10',
    chipText: 'text-emerald-400',
    chipBorder: 'border-emerald-500/30',
    dot: 'bg-emerald-400',
    label: 'Ata gerada',
  },
  artefatos_completos: {
    border: 'border-amber-700/50',
    bg: 'bg-amber-950/20',
    hoverBorder: 'hover:border-amber-500/60',
    chipBg: 'bg-amber-500/10',
    chipText: 'text-amber-400',
    chipBorder: 'border-amber-500/30',
    dot: 'bg-amber-400',
    label: 'Artefatos completos',
  },
  artefatos_faltantes: {
    border: 'border-red-700/50',
    bg: 'bg-red-950/20',
    hoverBorder: 'hover:border-red-500/60',
    chipBg: 'bg-red-500/10',
    chipText: 'text-red-400',
    chipBorder: 'border-red-500/30',
    dot: 'bg-red-400',
    label: 'Artefatos faltantes',
  },
  enfileirado: {
    border: 'border-blue-700/50',
    bg: 'bg-blue-950/20',
    hoverBorder: 'hover:border-blue-500/60',
    chipBg: 'bg-blue-500/10',
    chipText: 'text-blue-400',
    chipBorder: 'border-blue-500/30',
    dot: 'bg-blue-400',
    label: 'Na fila',
  },
  processando: {
    border: 'border-blue-700/50',
    bg: 'bg-blue-950/20',
    hoverBorder: 'hover:border-blue-500/60',
    chipBg: 'bg-blue-500/10',
    chipText: 'text-blue-400',
    chipBorder: 'border-blue-500/30',
    dot: 'bg-blue-400 animate-pulse',
    label: 'Processando',
  },
  processado: {
    border: 'border-cyan-700/50',
    bg: 'bg-cyan-950/20',
    hoverBorder: 'hover:border-cyan-500/60',
    chipBg: 'bg-cyan-500/10',
    chipText: 'text-cyan-400',
    chipBorder: 'border-cyan-500/30',
    dot: 'bg-cyan-400',
    label: 'Processado',
  },
  erro: {
    border: 'border-red-700/60',
    bg: 'bg-red-950/30',
    hoverBorder: 'hover:border-red-500/70',
    chipBg: 'bg-red-500/10',
    chipText: 'text-red-400',
    chipBorder: 'border-red-500/30',
    dot: 'bg-red-400',
    label: 'Erro',
  },
  ignorado: {
    border: 'border-zinc-700',
    bg: 'bg-zinc-900',
    hoverBorder: 'hover:border-zinc-600',
    chipBg: 'bg-zinc-800',
    chipText: 'text-zinc-500',
    chipBorder: 'border-zinc-700',
    dot: 'bg-zinc-500',
    label: 'Ignorado',
  },
};

function formatDate(d: string | null) {
  if (!d) return 'Não informada';
  const date = new Date(d);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.round(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}min`;
  return `${m}min`;
}

function formatResponsavel(raw: string | null): string {
  if (!raw) return 'Não informado';
  const local = raw.includes('@') ? raw.split('@')[0] : raw;
  return local
    .split('.')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

export default function ReuniaoCard({ meeting, onClick, onCreateAta, actionLoading }: Props) {
  const theme = THEMES[meeting.status] || THEMES.artefatos_faltantes;
  const canSend =
    meeting.status === 'artefatos_completos' ||
    meeting.status === 'artefatos_faltantes' ||
    meeting.status === 'erro';

  const artefatos = [
    { label: 'Gravação', ok: meeting.has_recording, link: meeting.recording_drive_link },
    { label: 'Transcrição', ok: meeting.has_transcript, link: meeting.transcript_drive_link },
    { label: 'Anotações', ok: meeting.has_smart_note, link: meeting.smart_note_drive_link },
  ];

  return (
    <div
      onClick={onClick}
      className={`group ${theme.bg} border ${theme.border} ${theme.hoverBorder} rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-xl active:scale-[0.98] select-none flex flex-col h-full`}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800/60 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-bold text-sm leading-snug line-clamp-2">
            {meeting.meeting_title || meeting.governanca?.titulo_reuniao || 'Reunião do Google Meet'}
          </h3>
          <p className="text-zinc-500 text-xs mt-1 truncate">{formatResponsavel(meeting.user_email)}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-semibold whitespace-nowrap ${theme.chipBg} ${theme.chipText} ${theme.chipBorder}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />
          {theme.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-5 py-3 space-y-2 flex-grow">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Data</span>
          <span className="text-zinc-300 font-medium">
            {formatDate(meeting.meeting_start_time || meeting.data_primeiro_artefato || meeting.governanca?.data_reuniao || null)}
          </span>
        </div>

        {(formatTime(meeting.meeting_start_time) || formatTime(meeting.meeting_end_time)) && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Horário</span>
            <span className="text-zinc-300 font-medium">
              {formatTime(meeting.meeting_start_time) || '—'}
              {' – '}
              {formatTime(meeting.meeting_end_time) || '—'}
            </span>
          </div>
        )}

        {formatDuration(meeting.meeting_start_time, meeting.meeting_end_time) && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Duração</span>
            <span className="text-zinc-300 font-medium">
              {formatDuration(meeting.meeting_start_time, meeting.meeting_end_time)}
            </span>
          </div>
        )}

        {/* Artefatos com links */}
        {artefatos.map((a) => (
          <div key={a.label} className="flex items-center justify-between text-xs">
            <span className="text-zinc-500 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${a.ok ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
              {a.label}
            </span>
            {a.ok && a.link ? (
              <a
                href={a.link}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-red-500 hover:text-red-400 font-semibold transition-colors"
              >
                Abrir
              </a>
            ) : a.ok ? (
              <span className="text-zinc-600 italic">Processando...</span>
            ) : (
              <span className="text-zinc-700">—</span>
            )}
          </div>
        ))}

        {meeting.drive_folder_link && (
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-zinc-500">Pasta</span>
            <a
              href={meeting.drive_folder_link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-red-500 hover:text-red-400 font-semibold transition-colors"
            >
              Drive
            </a>
          </div>
        )}

        {meeting.processing_last_error && (
          <p className="text-red-400 text-[11px] truncate" title={meeting.processing_last_error}>
            {meeting.processing_last_error}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-zinc-800/60 flex items-center gap-2">
        {canSend && onCreateAta ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateAta();
            }}
            disabled={actionLoading}
            className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg py-2 transition-all"
          >
            {actionLoading && (
              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            Criar ata
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg py-2 transition-all"
          >
            Ver detalhes
          </button>
        )}
      </div>
    </div>
  );
}
