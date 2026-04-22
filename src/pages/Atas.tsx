import { useState, useEffect, useCallback, useMemo } from 'react';
import { ataService, meetingsService } from '../lib/api';

type Tab = 'processando' | 'processado';

interface ProcessingItem {
  conference_id: string;
  status: string;
  user_email: string;
  meeting_title: string | null;
  meeting_start_time: string | null;
  meeting_end_time: string | null;
  ata_step: string | null;
  ata_progress: number | null;
  ata_step_started_at: string | null;
  ata_error_step: string | null;
  processing_attempt_count: number;
  processing_last_error: string | null;
  data_enfileirado: string | null;
  data_ultimo_erro: string | null;
  queued_by: string | null;
  updated_at: string;
}

interface ProcessedItem {
  conference_id: string;
  user_email: string;
  meeting_title: string | null;
  meeting_start_time: string | null;
  meeting_end_time: string | null;
  data_ata_gerada: string | null;
  ata_pdf_link: string | null;
  ata_link_download: string | null;
  queued_by: string | null;
}

const STEP_LABELS: Record<string, string> = {
  inicializando: 'Inicializando',
  baixando_artefatos: 'Baixando artefatos',
  analisando_ia: 'Analisando com IA',
  montando_html: 'Montando HTML',
  gerando_pdf: 'Gerando PDF',
  enviando_drive: 'Enviando ao Drive',
  salvando_dados: 'Salvando dados',
  concluido: 'Concluído',
};

const STEP_ORDER = [
  'inicializando',
  'baixando_artefatos',
  'analisando_ia',
  'montando_html',
  'gerando_pdf',
  'enviando_drive',
  'salvando_dados',
  'concluido',
];

function formatUser(email: string | null): string {
  if (!email) return 'Desconhecido';
  const local = email.includes('@') ? email.split('@')[0] : email;
  return local
    .split('.')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export default function AtasPage() {
  const [tab, setTab] = useState<Tab>('processando');
  const [processing, setProcessing] = useState<ProcessingItem[]>([]);
  const [processed, setProcessed] = useState<ProcessedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await ataService.progress();
      setProcessing(data.processing || []);
      setProcessed(data.processed || []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[atas] erro:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll mais frequente quando há items em processamento
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const hasErrors = useMemo(() => processing.some((p) => p.status === 'erro'), [processing]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28">
        <div className="w-6 h-6 border-2 border-red-600 border-t-transparent rounded-full animate-spin mb-5" />
        <p className="text-zinc-600 text-sm font-medium">Carregando processamento...</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-xs font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">Atas</p>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight">Processamento</h1>
            <p className="text-zinc-500 text-sm mt-2 font-normal">
              Geração de atas em tempo real · atualiza a cada 3s
              {lastUpdated && ` · ${lastUpdated.toLocaleTimeString('pt-BR')}`}
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

      {/* Sub-tabs */}
      <div className="flex gap-2 mb-6 border-b border-zinc-800">
        <TabButton active={tab === 'processando'} onClick={() => setTab('processando')}>
          Processando
          <CountBadge count={processing.length} accent={hasErrors ? 'red' : 'amber'} />
        </TabButton>
        <TabButton active={tab === 'processado'} onClick={() => setTab('processado')}>
          Processado
          <CountBadge count={processed.length} accent="emerald" />
        </TabButton>
      </div>

      {tab === 'processando' ? (
        <ProcessingList items={processing} onRefresh={load} />
      ) : (
        <ProcessedList items={processed} />
      )}
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
        active ? 'border-red-600 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}

function CountBadge({ count, accent }: { count: number; accent: 'red' | 'amber' | 'emerald' }) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full bg-zinc-800 text-zinc-500">
        0
      </span>
    );
  }
  const color = {
    red: 'bg-red-600 text-white',
    amber: 'bg-amber-500 text-black',
    emerald: 'bg-emerald-600 text-white',
  }[accent];
  return (
    <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full ${color}`}>
      {count}
    </span>
  );
}

function ProcessingList({ items, onRefresh }: { items: ProcessingItem[]; onRefresh: () => void }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 bg-[#111111] border border-zinc-800 rounded-2xl">
        <p className="text-white font-bold text-base mb-2">Nada na fila</p>
        <p className="text-zinc-600 text-sm max-w-[360px] leading-relaxed">
          Quando você clicar em <strong className="text-zinc-400">"Criar Ata"</strong> numa reunião, ela aparece aqui em tempo real com o progresso por etapa.
        </p>
        <p className="text-zinc-700 text-xs mt-3 max-w-[360px] leading-relaxed">
          Se clicou e nada apareceu: confira se recebeu alerta de erro. Se não: o clique pode não ter passado pela fila (QStash). Vá em Reuniões e clique novamente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <ProcessingCard key={item.conference_id} item={item} position={idx + 1} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function ProcessingCard({ item, position, onRefresh }: { item: ProcessingItem; position: number; onRefresh: () => void }) {
  const isError = item.status === 'erro';
  const isEnfileirado = item.status === 'enfileirado';
  const progress = item.ata_progress ?? (isEnfileirado ? 0 : 0);
  const currentStep = item.ata_step || 'aguardando';
  const currentStepLabel = STEP_LABELS[currentStep] || 'Aguardando fila';
  const errorStep = item.ata_error_step;
  const errorStepLabel = errorStep ? STEP_LABELS[errorStep] || errorStep : null;
  const [retrying, setRetrying] = useState(false);

  const themeBorder = isError ? 'border-red-700/60' : 'border-zinc-800';
  const themeBg = isError ? 'bg-red-950/20' : 'bg-[#111111]';

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await meetingsService.enqueueAta([item.conference_id]);
      onRefresh();
    } catch (err) {
      console.error('[retry-ata] falhou:', err);
      alert('Falha ao reenfileirar. Tente novamente.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className={`${themeBg} border ${themeBorder} rounded-2xl p-5`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
            isError ? 'bg-red-600 text-white' : isEnfileirado ? 'bg-zinc-800 text-zinc-400' : 'bg-amber-500 text-black'
          }`}>
            {isError ? '!' : position}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-white font-bold text-sm leading-snug truncate">
              {item.meeting_title || 'Reunião sem título'}
            </h3>
            <p className="text-zinc-500 text-xs mt-1 truncate">
              {formatUser(item.user_email)} · {formatDateTime(item.meeting_start_time)}
            </p>
          </div>
        </div>
        <StatusPill status={item.status} />
      </div>

      {/* Barra de progresso */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <p className={`text-xs font-semibold ${isError ? 'text-red-400' : 'text-zinc-300'}`}>
            {isError ? `Erro em: ${errorStepLabel || 'desconhecido'}` : currentStepLabel}
          </p>
          <p className="text-xs font-bold text-white">{progress}%</p>
        </div>
        <div className="h-2 bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isError ? 'bg-red-600' : progress === 100 ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      </div>

      {/* Steps visualmente */}
      <div className="flex items-center gap-1 mt-3 overflow-x-auto">
        {STEP_ORDER.filter((s) => s !== 'concluido').map((step) => {
          const stepIdx = STEP_ORDER.indexOf(step);
          const currentIdx = STEP_ORDER.indexOf(currentStep);
          const done = !isError && currentIdx > stepIdx;
          const active = !isError && currentIdx === stepIdx;
          const errored = isError && errorStep === step;
          return (
            <div key={step} className="flex items-center gap-1 shrink-0">
              <div
                className={`w-2 h-2 rounded-full ${
                  errored ? 'bg-red-500' : done ? 'bg-emerald-500' : active ? 'bg-amber-500 animate-pulse' : 'bg-zinc-800'
                }`}
                title={STEP_LABELS[step]}
              />
              {step !== 'salvando_dados' && <div className="w-4 h-px bg-zinc-800" />}
            </div>
          );
        })}
      </div>

      {/* Info adicional */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-zinc-600">
        {item.processing_attempt_count > 0 && (
          <span>Tentativa: <span className="text-zinc-400 font-medium">{item.processing_attempt_count}</span></span>
        )}
        {item.data_enfileirado && (
          <span>Enfileirada <span className="text-zinc-400 font-medium">{formatRelative(item.data_enfileirado)}</span></span>
        )}
        {item.queued_by && (
          <span>por <span className="text-zinc-400 font-medium">{item.queued_by}</span></span>
        )}
      </div>

      {/* Erro */}
      {item.processing_last_error && (
        <div className="mt-3 p-3 rounded-lg bg-red-950/40 border border-red-800/60">
          <p className="text-red-400 text-xs font-semibold mb-1">Erro</p>
          <p className="text-red-300 text-xs leading-relaxed break-all">{item.processing_last_error}</p>
        </div>
      )}

      {/* Botão Retry (só se status=erro) */}
      {isError && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg px-4 py-2 transition-all"
          >
            {retrying && (
              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {retrying ? 'Reenfileirando...' : 'Tentar novamente'}
          </button>
        </div>
      )}
    </div>
  );
}

function ProcessedList({ items }: { items: ProcessedItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 bg-[#111111] border border-zinc-800 rounded-2xl">
        <p className="text-white font-bold text-base mb-2">Nenhuma ata processada</p>
        <p className="text-zinc-600 text-sm">Atas geradas nos últimos 30 dias aparecem aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.conference_id}
          className="bg-[#111111] border border-emerald-900/40 rounded-2xl p-5 flex items-center gap-4"
        >
          <span className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
            ✓
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-white font-bold text-sm leading-snug truncate">
              {item.meeting_title || 'Reunião sem título'}
            </h3>
            <p className="text-zinc-500 text-xs mt-1 truncate">
              {formatUser(item.user_email)} · {formatDateTime(item.meeting_start_time)} · Gerada {formatRelative(item.data_ata_gerada)}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {item.ata_pdf_link && (
              <a
                href={item.ata_pdf_link}
                target="_blank"
                rel="noreferrer"
                className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg px-3 py-2 transition-all"
              >
                Abrir PDF
              </a>
            )}
            {item.ata_link_download && (
              <a
                href={item.ata_link_download}
                target="_blank"
                rel="noreferrer"
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg px-3 py-2 transition-all"
              >
                Baixar
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    enfileirado: { label: 'Na fila', color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
    processando: { label: 'Processando', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
    erro: { label: 'Erro', color: 'bg-red-500/10 text-red-400 border-red-500/30' },
  };
  const m = map[status] || { label: status, color: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-semibold whitespace-nowrap ${m.color}`}>
      {m.label}
    </span>
  );
}
