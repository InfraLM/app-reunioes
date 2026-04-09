import { useState, useEffect, useRef, useMemo } from 'react';
import { reunioesService } from '../lib/api';
import type { Reuniao } from '../types';
import ReuniaoCard from '../components/Reunioes/ReuniaoCard';
import ReuniaoModal from '../components/Reunioes/ReuniaoModal';
import DateRangePicker, { type DateRange } from '../components/Reunioes/DateRangePicker';

type SortBy = 'date_desc' | 'date_asc' | 'title_asc' | 'title_desc' | 'artifacts_desc';
type ArtifactFilter = 'all' | 'complete' | 'partial' | 'none';

const PAGE_SIZE = 18;

const ARTIFACT_OPTS: { value: ArtifactFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'complete', label: '4/4' },
  { value: 'partial', label: 'Parciais' },
  { value: 'none', label: 'Sem artefatos' },
];

const SORT_OPTS: { value: SortBy; label: string }[] = [
  { value: 'date_desc', label: '↓ Mais recente' },
  { value: 'date_asc', label: '↑ Mais antigo' },
  { value: 'title_asc', label: 'A→Z Título' },
  { value: 'title_desc', label: 'Z→A Título' },
  { value: 'artifacts_desc', label: '★ Mais artefatos' },
];

function countArtifacts(r: Reuniao) {
  return [r.link_gravacao, r.link_transcricao, r.link_anotacao, r.ata_link_download].filter(Boolean).length;
}

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getPageNums(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

function fmtShort(d: Date | null) {
  if (!d) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function ReunioesPage() {
  const [reunioes, setReunioes] = useState<Reuniao[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReuniao, setSelectedReuniao] = useState<Reuniao | null>(null);

  // Filters & sort
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date_desc');
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null });
  const [artifactFilter, setArtifactFilter] = useState<ArtifactFilter>('all');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const datePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await reunioesService.listar({ limit: 100, offset: 0 });
        setReunioes(data.data || []);
      } catch (e) {
        console.error('Erro ao carregar reuniões:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Close date picker on outside click
  useEffect(() => {
    if (!showDatePicker) return;
    const handler = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDatePicker]);

  // Reset page whenever filters change
  useEffect(() => { setCurrentPage(1); }, [searchText, sortBy, dateRange, artifactFilter]);

  const filtered = useMemo(() => {
    let r = [...reunioes];

    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim();
      r = r.filter(m =>
        m.titulo_reuniao?.toLowerCase().includes(q) ||
        m.responsavel?.toLowerCase().includes(q) ||
        m.participantes_nomes?.toLowerCase().includes(q)
      );
    }

    if (dateRange.start) {
      const s = toLocalDateStr(dateRange.start);
      r = r.filter(m => m.data_reuniao && m.data_reuniao.split('T')[0] >= s);
    }
    if (dateRange.end) {
      const e = toLocalDateStr(dateRange.end);
      r = r.filter(m => m.data_reuniao && m.data_reuniao.split('T')[0] <= e);
    }

    if (artifactFilter === 'complete') r = r.filter(m => countArtifacts(m) === 4);
    else if (artifactFilter === 'partial') r = r.filter(m => { const c = countArtifacts(m); return c > 0 && c < 4; });
    else if (artifactFilter === 'none') r = r.filter(m => countArtifacts(m) === 0);

    r.sort((a, b) => {
      switch (sortBy) {
        case 'date_asc': return (a.data_reuniao ?? '').localeCompare(b.data_reuniao ?? '');
        case 'title_asc': return (a.titulo_reuniao ?? '').localeCompare(b.titulo_reuniao ?? '', 'pt');
        case 'title_desc': return (b.titulo_reuniao ?? '').localeCompare(a.titulo_reuniao ?? '', 'pt');
        case 'artifacts_desc': return countArtifacts(b) - countArtifacts(a);
        default: return (b.data_reuniao ?? '').localeCompare(a.data_reuniao ?? '');
      }
    });

    return r;
  }, [reunioes, searchText, dateRange, artifactFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasActiveFilters = !!(searchText || dateRange.start || artifactFilter !== 'all');

  return (
    <>
      {/* Page header */}
      <div className="mb-6">
        <p className="text-xs font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">Histórico</p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight">
              Reuniões de Governança
            </h1>
            {!loading && (
              <p className="text-zinc-500 text-sm mt-2 font-normal">
                {reunioes.length} {reunioes.length === 1 ? 'reunião armazenada' : 'reuniões armazenadas'}
              </p>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-28">
          <div className="w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mb-5" />
          <p className="text-zinc-600 text-sm font-medium">Carregando reuniões...</p>
        </div>
      ) : reunioes.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-28">
          <div className="w-14 h-14 bg-[#111111] border border-zinc-800 rounded-2xl flex items-center justify-center mb-5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <p className="text-white font-bold text-base mb-2">Nenhuma reunião encontrada</p>
          <p className="text-zinc-600 text-sm max-w-xs leading-relaxed font-normal">
            As reuniões aparecerão aqui após serem processadas pelo sistema.
          </p>
        </div>
      ) : (
        <>
          {/* ── Filter bar ── */}
          <div className="bg-[#111111] border border-zinc-800 rounded-2xl px-5 py-4 mb-6 flex flex-wrap gap-3 items-center">

            {/* Search */}
            <div className="relative flex-1 min-w-[220px]">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="Buscar título, responsável, participante..."
                className="w-full pl-9 pr-9 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-yellow-400/60 focus:ring-1 focus:ring-yellow-400/20 transition-colors"
              />
              {searchText && (
                <button
                  onClick={() => setSearchText('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            <div className="hidden sm:block w-px h-6 bg-zinc-800 flex-shrink-0" />

            {/* Date range */}
            <div className="relative flex-shrink-0" ref={datePickerRef}>
              <button
                onClick={() => setShowDatePicker(v => !v)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap ${dateRange.start
                  ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
                  }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                {dateRange.start
                  ? `${fmtShort(dateRange.start)} – ${dateRange.end ? fmtShort(dateRange.end) : '...'}`
                  : 'Período'
                }
                {dateRange.start && (
                  <span
                    onClick={e => { e.stopPropagation(); setDateRange({ start: null, end: null }); }}
                    className="ml-1 text-yellow-400/60 hover:text-yellow-400 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </span>
                )}
              </button>
              {showDatePicker && (
                <div className="absolute top-full mt-2 left-0 z-50">
                  <DateRangePicker
                    value={dateRange}
                    onChange={setDateRange}
                    onClose={() => setShowDatePicker(false)}
                  />
                </div>
              )}
            </div>

            <div className="hidden sm:block w-px h-6 bg-zinc-800 flex-shrink-0" />

            {/* Artifact filter pills */}
            <div className="flex gap-1.5 flex-shrink-0">
              {ARTIFACT_OPTS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setArtifactFilter(opt.value)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${artifactFilter === opt.value
                    ? 'bg-yellow-400 text-black'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white hover:border-zinc-700'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Sort – pushed to the right */}
            <div className="ml-auto flex-shrink-0 relative">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortBy)}
                className="appearance-none bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-semibold rounded-xl pl-3 pr-8 py-2.5 focus:outline-none focus:border-yellow-400/60 cursor-pointer hover:border-zinc-700 hover:text-white transition-colors"
              >
                {SORT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          {/* No filter results */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-20">
              <div className="w-12 h-12 bg-[#111111] border border-zinc-800 rounded-2xl flex items-center justify-center mb-4">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <p className="text-white font-bold text-base mb-2">Nenhum resultado</p>
              <p className="text-zinc-600 text-sm max-w-[260px] leading-relaxed">
                Nenhuma reunião corresponde aos filtros aplicados.
              </p>
              {hasActiveFilters && (
                <button
                  onClick={() => { setSearchText(''); setDateRange({ start: null, end: null }); setArtifactFilter('all'); }}
                  className="mt-4 px-4 py-2 text-xs font-bold text-yellow-400 border border-yellow-400/30 rounded-xl hover:bg-yellow-400/10 transition-colors"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Cards grid */}
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {paginated.map(reuniao => (
                  <ReuniaoCard
                    key={reuniao.id}
                    reuniao={reuniao}
                    onClick={() => setSelectedReuniao(reuniao)}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-10 flex flex-col items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>

                    {getPageNums(currentPage, totalPages).map((page, i) =>
                      page === '...'
                        ? <span key={`e${i}`} className="w-9 h-9 flex items-center justify-center text-zinc-700 text-sm select-none">…</span>
                        : <button
                          key={page}
                          onClick={() => setCurrentPage(page as number)}
                          className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-bold transition-colors ${currentPage === page
                            ? 'bg-yellow-400 text-black'
                            : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
                            }`}
                        >
                          {page}
                        </button>
                    )}

                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>

                  <p className="text-zinc-700 text-xs">
                    {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} de {filtered.length} reuniões
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {selectedReuniao && (
        <ReuniaoModal
          reuniao={selectedReuniao}
          onClose={() => setSelectedReuniao(null)}
        />
      )}
    </>
  );
}
