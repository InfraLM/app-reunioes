import { useState, useEffect, useCallback } from 'react';
import { statsService } from '../lib/api';

type Period = 'today' | '7d' | '30d' | 'all' | 'custom';

interface RecentCall {
  id: string;
  created_at: string;
  conference_id: string | null;
  endpoint: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  status: 'success' | 'error';
  error_message: string | null;
}

interface DailyPoint {
  day: string;
  calls: number;
  input: number;
  output: number;
  cost_usd: number;
  cost_brl: number;
}

interface AiUsageResponse {
  period: string;
  brl_per_usd: number;
  totals: {
    calls: number;
    success: number;
    error: number;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    cost_usd: number;
    cost_brl: number;
  };
  daily: DailyPoint[];
  recent: RecentCall[];
}

const PERIOD_OPTS: { value: Period; label: string; title: string }[] = [
  { value: 'today', label: 'Hoje', title: 'Últimas 24 horas' },
  { value: '7d', label: '7 dias', title: 'Últimos 7 dias' },
  { value: '30d', label: '30 dias', title: 'Últimos 30 dias' },
  { value: 'all', label: 'Tudo', title: 'Desde o primeiro registro' },
  { value: 'custom', label: 'Datas', title: 'Intervalo manual' },
];

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatUSD(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

function formatBRL(n: number): string {
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function UsoIAPage() {
  const [data, setData] = useState<AiUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('30d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { period };
      if (period === 'custom') {
        if (from) params.from = from;
        if (to) params.to = to;
      }
      const res = await statsService.aiUsage(params);
      setData(res);
    } catch (e) {
      console.error('Erro ao carregar uso IA:', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const t = data?.totals;
  const totalTokens = (t?.input_tokens || 0) + (t?.output_tokens || 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white">Uso de IA</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Tracking de chamadas à API Anthropic — tokens, chamadas e custo estimado.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 p-1 bg-zinc-900 border border-zinc-800 rounded-lg">
            {PERIOD_OPTS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                title={opt.title}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  period === opt.value
                    ? 'bg-red-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300"
              />
            </>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Chamadas" value={loading ? '—' : formatNum(t?.calls || 0)}
          sub={loading ? '' : `${t?.success || 0} ok · ${t?.error || 0} erro`}
          accent="text-white" />
        <Card label="Tokens (in + out)" value={loading ? '—' : formatNum(totalTokens)}
          sub={loading ? '' : `${formatNum(t?.input_tokens || 0)} in · ${formatNum(t?.output_tokens || 0)} out`}
          accent="text-blue-400" />
        <Card label="Custo (USD)" value={loading ? '—' : formatUSD(t?.cost_usd || 0)}
          sub="Cálculo client-side, baseado no preço do model"
          accent="text-amber-400" />
        <Card label="Custo (BRL)" value={loading ? '—' : formatBRL(t?.cost_brl || 0)}
          sub={data ? `Cotação fixa: 1 USD ≈ R$ ${data.brl_per_usd.toFixed(2)}` : ''}
          accent="text-emerald-400" />
      </div>

      {/* Tabela de chamadas recentes */}
      <div className="bg-[#0c0c0c] border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center justify-between">
          <h2 className="text-white font-bold text-sm">Chamadas recentes</h2>
          <span className="text-zinc-600 text-xs">{loading ? 'carregando…' : `${data?.recent.length || 0} entradas`}</span>
        </div>

        {loading ? (
          <div className="px-5 py-12 text-center text-zinc-600 text-sm">Carregando…</div>
        ) : !data?.recent.length ? (
          <div className="px-5 py-12 text-center text-zinc-600 text-sm">
            Nenhuma chamada no período. Tracking começa após o deploy desta feature.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900/50 text-zinc-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Quando</th>
                  <th className="px-4 py-3 text-left font-semibold">Endpoint</th>
                  <th className="px-4 py-3 text-left font-semibold">Modelo</th>
                  <th className="px-4 py-3 text-right font-semibold">In</th>
                  <th className="px-4 py-3 text-right font-semibold">Out</th>
                  <th className="px-4 py-3 text-right font-semibold">Custo USD</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Conference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {data.recent.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-900/30">
                    <td className="px-4 py-2.5 text-zinc-300 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                    <td className="px-4 py-2.5 text-zinc-300 font-mono">{r.endpoint}</td>
                    <td className="px-4 py-2.5 text-zinc-400 font-mono text-[11px]">{r.model}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono">{formatNum(r.input_tokens)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono">{formatNum(r.output_tokens)}</td>
                    <td className="px-4 py-2.5 text-right text-amber-400 font-mono">${r.cost_usd.toFixed(4)}</td>
                    <td className="px-4 py-2.5">
                      {r.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          ok
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-400 text-[11px] font-semibold" title={r.error_message || ''}>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                          erro
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 font-mono text-[10px]">
                      {r.conference_id ? r.conference_id.slice(-20) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Aviso sobre tracking */}
      <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-4">
        <p className="text-zinc-500 text-xs leading-relaxed">
          <strong className="text-zinc-400">Observações:</strong> Tracking começa a partir da data
          em que esta feature foi deployada — gastos anteriores não aparecem.
          Saldo restante na conta Anthropic não é mostrado aqui (a API não expõe sem Admin Key);
          consulte em <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-red-500 hover:text-red-400 underline">console.anthropic.com</a>.
          Custos são estimativas baseadas na tabela de preços do modelo no momento da chamada.
        </p>
      </div>
    </div>
  );
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="bg-[#0c0c0c] border border-zinc-800 rounded-2xl p-5 flex flex-col gap-1.5">
      <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-black ${accent}`}>{value}</span>
      {sub && <span className="text-zinc-600 text-[11px] mt-1">{sub}</span>}
    </div>
  );
}
