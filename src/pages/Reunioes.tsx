import { useState, useEffect, useMemo, useCallback } from 'react';
import { meetingsService } from '../lib/api';
import type { MeetStatus, MeetLifecycleStatus } from '../types';
import ReuniaoCard from '../components/Reunioes/ReuniaoCard';
import ReuniaoModal from '../components/Reunioes/ReuniaoModal';

type SortBy = 'date_desc' | 'date_asc' | 'title_asc' | 'title_desc';
type StatusFilter = 'all' | MeetLifecycleStatus;
type DateFilter = 'hoje' | '48h' | 'todas' | 'range';
type ArtefatosFilter = 'all' | '0' | '1' | '2' | '3';

const PAGE_SIZE = 18;

const STATUS_OPTS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'ata_gerada', label: 'Ata gerada' },
  { value: 'artefatos_completos', label: 'Completos' },
  { value: 'artefatos_faltantes', label: 'Faltantes' },
  { value: 'enfileirado', label: 'Na fila' },
  { value: 'erro', label: 'Erro' },
];

const DATE_OPTS: { value: DateFilter; label: string; title?: string }[] = [
  { value: 'hoje', label: 'Hoje', title: 'Últimas 24 horas' },
  { value: '48h', label: 'Últimas 48h', title: 'Últimas 48 horas' },
  { value: 'todas', label: 'Todas', title: 'Sem filtro de data' },
  { value: 'range', label: 'Datas', title: 'Intervalo de datas manual' },
];

const ARTEFATOS_OPTS: { value: ArtefatosFilter; label: string; title: string }[] = [
  { value: 'all', label: 'Todos', title: 'Qualquer quantidade de artefatos' },
  { value: '3', label: '3 artefatos', title: 'Gravação + transcrição + anotações' },
  { value: '2', label: '2', title: 'Exatamente 2 dos 3 artefatos' },
  { value: '1', label: '1', title: 'Apenas 1 dos 3 artefatos' },
  { value: '0', label: '0', title: 'Nenhum artefato (só started/ended)' },
];

const SORT_OPTS: { value: SortBy; label: string }[] = [
  { value: 'date_desc', label: '↓ Mais recente' },
  { value: 'date_asc', label: '↑ Mais antigo' },
  { value: 'title_asc', label: 'A→Z Título' },
  { value: 'title_desc', label: 'Z→A Título' },
];

function getPageNums(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

export default function ReunioesPage() {
  const [meetings, setMeetings] = useState<MeetStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MeetStatus | null>(null);

  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date_desc');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('hoje');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [artefatosFilter, setArtefatosFilter] = useState<ArtefatosFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);

  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await meetingsService.list('todos');
      setMeetings(res.meetings || []);
    } catch (e) {
      console.error('Erro ao carregar meetings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // atualiza a cada 30s
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, statusFilter, sortBy, userFilter, dateFilter, dateFrom, dateTo, artefatosFilter]);

  const userOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of meetings) if (m.user_email) set.add(m.user_email);
    return Array.from(set).sort();
  }, [meetings]);

  const handleCreateAta = async (conferenceId: string) => {
    setActionLoading((p) => ({ ...p, [conferenceId]: true }));
    try {
      const res = await meetingsService.enqueueAta([conferenceId]);
      const errCount = res?.summary?.error ?? 0;
      if (errCount > 0) {
        const msg = res?.results?.find((r: { status: string; message?: string }) => r.status === 'error')?.message || 'Erro desconhecido';
        alert(`Não foi possível enfileirar a geração da ata:\n\n${msg}\n\nVerifique /app/atas ou contate o admin.`);
      }
      // Fica na mesma tela — load() recarrega os cards, que mudam de
      // "artefatos_completos" para "enfileirado" (azul). Usuário vê
      // o progresso sem sair de /reunioes.
      await load();
    } catch (e) {
      const err = e as { response?: { data?: { summary?: { error?: number }; results?: Array<{ status: string; message?: string }> } }; message?: string };
      const msg =
        err?.response?.data?.results?.find((r) => r.status === 'error')?.message ||
        err?.message ||
        'Falha na requisição';
      console.error('Erro ao enfileirar ata:', e);
      alert(`Erro ao enfileirar ata:\n\n${msg}`);
    } finally {
      setActionLoading((p) => {
        const next = { ...p };
        delete next[conferenceId];
        return next;
      });
    }
  };

  const filtered = useMemo(() => {
    let r = [...meetings];
    const getDateStr = (m: MeetStatus) =>
      m.meeting_start_time || m.data_primeiro_artefato || m.governanca?.data_reuniao || null;

    // Calcula janela efetiva com base no filtro de data ativo.
    let effectiveFrom: Date | null = null;
    let effectiveTo: Date | null = null;
    const now = new Date();
    if (dateFilter === 'hoje') {
      effectiveFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (dateFilter === '48h') {
      effectiveFrom = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    } else if (dateFilter === 'range') {
      if (dateFrom) effectiveFrom = new Date(dateFrom);
      if (dateTo) effectiveTo = new Date(`${dateTo}T23:59:59`);
    }
    // 'todas': nada a aplicar

    if (effectiveFrom) {
      r = r.filter((m) => {
        const d = getDateStr(m);
        return !!d && new Date(d) >= effectiveFrom!;
      });
    }
    if (effectiveTo) {
      r = r.filter((m) => {
        const d = getDateStr(m);
        return !!d && new Date(d) <= effectiveTo!;
      });
    }
    if (artefatosFilter !== 'all') {
      const target = parseInt(artefatosFilter, 10);
      r = r.filter((m) => {
        const count = (m.has_recording ? 1 : 0) + (m.has_transcript ? 1 : 0) + (m.has_smart_note ? 1 : 0);
        return count === target;
      });
    }
    if (userFilter !== 'all') {
      r = r.filter((m) => m.user_email === userFilter);
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim();
      r = r.filter(
        (m) =>
          m.meeting_title?.toLowerCase().includes(q) ||
          m.user_email?.toLowerCase().includes(q) ||
          m.governanca?.titulo_reuniao?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      r = r.filter((m) => m.status === statusFilter);
    }
    r.sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':
          return (a.meeting_start_time ?? '').localeCompare(b.meeting_start_time ?? '');
        case 'title_asc':
          return (a.meeting_title ?? '').localeCompare(b.meeting_title ?? '', 'pt');
        case 'title_desc':
          return (b.meeting_title ?? '').localeCompare(a.meeting_title ?? '', 'pt');
        default:
          return (b.meeting_start_time ?? '').localeCompare(a.meeting_start_time ?? '');
      }
    });
    return r;
  }, [meetings, searchText, statusFilter, sortBy, userFilter, dateFilter, dateFrom, dateTo, artefatosFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // summary
  const summary = useMemo(() => {
    const s = { total: meetings.length, ata_gerada: 0, completos: 0, faltantes: 0, outros: 0 };
    for (const m of meetings) {
      if (m.status === 'ata_gerada') s.ata_gerada++;
      else if (m.status === 'artefatos_completos') s.completos++;
      else if (m.status === 'artefatos_faltantes') s.faltantes++;
      else s.outros++;
    }
    return s;
  }, [meetings]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28">
        <div className="w-6 h-6 border-2 border-red-600 border-t-transparent rounded-full animate-spin mb-5" />
        <p className="text-zinc-600 text-sm font-medium">Carregando reuniões...</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-xs font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">Histórico</p>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight">Reuniões</h1>
            <p className="text-zinc-500 text-sm mt-2 font-normal">
              {summary.total} reuniões · 🟢 {summary.ata_gerada} atas · 🟡 {summary.completos} completos · 🔴 {summary.faltantes} faltantes
            </p>
          </div>
          <button
            onClick={load}
            className="bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-[#111111] border border-zinc-800 rounded-2xl px-5 py-4 mb-6 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar título, responsável..."
            className="w-full pl-9 pr-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-600/60 focus:ring-1 focus:ring-red-600/20 transition-colors"
          />
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                statusFilter === opt.value
                  ? 'bg-red-600 text-white'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white hover:border-zinc-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-semibold rounded-xl px-3 py-2.5 focus:outline-none focus:border-red-600/60 cursor-pointer hover:text-white transition-colors"
          >
            {SORT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filtros avançados: usuário, data, artefatos */}
      <div className="bg-[#111111] border border-zinc-800 rounded-2xl px-5 py-4 mb-6 flex flex-wrap gap-3 items-center">
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl px-3 py-2.5 focus:outline-none focus:border-red-600/60 cursor-pointer hover:text-white transition-colors min-w-[220px]"
        >
          <option value="all">Todos os usuários</option>
          {userOptions.map((email) => (
            <option key={email} value={email}>
              {email}
            </option>
          ))}
        </select>

        {/* Filtro de data — 4 botões mutuamente exclusivos */}
        <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
          {DATE_OPTS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDateFilter(opt.value)}
              title={opt.title}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                dateFilter === opt.value
                  ? 'bg-red-600 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Inputs de data só quando dateFilter === 'range' */}
        {dateFilter === 'range' && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-zinc-500 text-xs font-semibold">De</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl px-3 py-2.5 focus:outline-none focus:border-red-600/60 cursor-pointer hover:text-white transition-colors"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-zinc-500 text-xs font-semibold">Até</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl px-3 py-2.5 focus:outline-none focus:border-red-600/60 cursor-pointer hover:text-white transition-colors"
              />
            </div>
          </>
        )}

        {/* Filtro de artefatos */}
        <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
          {ARTEFATOS_OPTS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setArtefatosFilter(opt.value)}
              title={opt.title}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                artefatosFilter === opt.value
                  ? 'bg-red-600 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {(userFilter !== 'all' || dateFilter !== 'hoje' || dateFrom || dateTo || artefatosFilter !== 'all') && (
          <button
            onClick={() => {
              setUserFilter('all');
              setDateFilter('hoje');
              setDateFrom('');
              setDateTo('');
              setArtefatosFilter('all');
            }}
            className="ml-auto text-zinc-500 hover:text-white text-xs font-semibold transition-colors"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <p className="text-white font-bold text-base mb-2">Nenhuma reunião</p>
          <p className="text-zinc-600 text-sm max-w-[260px] leading-relaxed">
            Nenhuma reunião corresponde aos filtros aplicados.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {paginated.map((m) => (
              <ReuniaoCard
                key={m.conference_id}
                meeting={m}
                onClick={() => setSelected(m)}
                onCreateAta={() => handleCreateAta(m.conference_id)}
                actionLoading={actionLoading[m.conference_id]}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-10 flex flex-col items-center gap-3">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ‹
                </button>
                {getPageNums(currentPage, totalPages).map((page, i) =>
                  page === '...' ? (
                    <span key={`e${i}`} className="w-9 h-9 flex items-center justify-center text-zinc-700 text-sm">
                      …
                    </span>
                  ) : (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page as number)}
                      className={`w-9 h-9 rounded-xl text-sm font-bold transition-colors ${
                        currentPage === page ? 'bg-red-600 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      {page}
                    </button>
                  )
                )}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ›
                </button>
              </div>
              <p className="text-zinc-700 text-xs">
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} de {filtered.length}
              </p>
            </div>
          )}
        </>
      )}

      {selected && selected.governanca && (
        <ReuniaoModal reuniao={selected.governanca} onClose={() => setSelected(null)} />
      )}
      {selected && !selected.governanca && (
        <MinimalDetailsModal meeting={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function MinimalDetailsModal({ meeting, onClose }: { meeting: MeetStatus; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-[#111111] border border-zinc-800 rounded-2xl p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-xl font-black text-white">{meeting.meeting_title || 'Reunião'}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">✕</button>
        </div>
        <div className="space-y-3 text-sm">
          <Row label="Status" value={meeting.status} />
          <Row label="Organizador" value={meeting.user_email} />
          <Row label="Conference ID" value={meeting.conference_id} mono />
          {meeting.meeting_start_time && <Row label="Início" value={new Date(meeting.meeting_start_time).toLocaleString('pt-BR')} />}
          {meeting.meeting_end_time && <Row label="Fim" value={new Date(meeting.meeting_end_time).toLocaleString('pt-BR')} />}
          <ArtifactRow label="Gravação" ok={meeting.has_recording} link={meeting.recording_original_link || meeting.recording_drive_link} />
          <ArtifactRow label="Transcrição" ok={meeting.has_transcript} link={meeting.transcript_original_link || meeting.transcript_drive_link} />
          <ArtifactRow label="Smart Notes" ok={meeting.has_smart_note} link={meeting.smart_note_original_link || meeting.smart_note_drive_link} />
          {meeting.drive_folder_link && (
            <a href={meeting.drive_folder_link} target="_blank" rel="noreferrer" className="block text-red-500 underline text-xs break-all">
              Abrir pasta no Drive
            </a>
          )}
          {meeting.processing_last_error && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-red-400 text-xs">
              <strong>Último erro:</strong> {meeting.processing_last_error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500 text-xs font-semibold">{label}</span>
      <span className={`text-zinc-300 text-xs ${mono ? 'font-mono' : ''} break-all text-right`}>{value}</span>
    </div>
  );
}

function ArtifactRow({ label, ok, link }: { label: string; ok: boolean; link: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500 text-xs font-semibold flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
        {label}
      </span>
      {ok && link ? (
        <a href={link} target="_blank" rel="noreferrer" className="text-red-500 hover:text-red-400 text-xs font-bold">
          Abrir
        </a>
      ) : (
        <span className="text-zinc-600 text-xs">{ok ? 'Processando...' : '—'}</span>
      )}
    </div>
  );
}
