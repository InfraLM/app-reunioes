import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { statsService } from '../lib/api';

interface DashboardData {
  total: number;
  reunioes_mes: number;
  reunioes_semana: number;
  duracao_media_min: number;
  ranking_mes: { user_email: string; count: number }[];
  weekly: { week_start: string; count: number }[];
  comite_pie: { name: string; value: number }[];
  status_dist: { name: string; value: number }[];
  artifacts_counts: { recording: number; transcript: number; smart_note: number };
}

const COLORS_COMITE = ['#ef4444', '#3f3f46'];
const COLORS_STATUS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#06b6d4', '#dc2626', '#71717a'];

function formatUser(email: string): string {
  const local = email.includes('@') ? email.split('@')[0] : email;
  return local
    .split('.')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function formatWeekLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const STATUS_LABELS: Record<string, string> = {
  artefatos_faltantes: 'Faltantes',
  artefatos_completos: 'Completos',
  webhook_enfileirado: 'Na fila',
  webhook_enviando: 'Enviando',
  webhook_enviado: 'Enviado',
  webhook_erro: 'Erro',
  ata_gerada: 'Ata gerada',
  ignorado: 'Ignorado',
  pending: 'Pendente',
  complete: 'Concluído',
};

export default function HomePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    statsService
      .dashboard()
      .then(setData)
      .catch((err) => console.error('[home] erro:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28">
        <div className="w-6 h-6 border-2 border-red-600 border-t-transparent rounded-full animate-spin mb-5" />
        <p className="text-zinc-600 text-sm font-medium">Carregando dashboard...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-20 text-center text-zinc-500">Não foi possível carregar o dashboard.</div>
    );
  }

  const comitePct =
    data.total > 0
      ? Math.round(((data.comite_pie[0]?.value || 0) / data.total) * 100)
      : 0;

  return (
    <>
      <div className="mb-8">
        <p className="text-xs font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">Painel</p>
        <h1 className="text-4xl font-black text-white tracking-tight">Home</h1>
        <p className="text-zinc-500 text-sm mt-2 font-normal">
          Visão geral das reuniões desde 10/04/2026
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Total" value={data.total} />
        <Kpi label="Neste mês" value={data.reunioes_mes} />
        <Kpi label="Esta semana" value={data.reunioes_semana} />
        <Kpi label="Duração média" value={`${data.duracao_media_min}min`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Reuniões semanais */}
        <Card title="Reuniões por semana" subtitle="Últimas 8 semanas">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weekly.map((w) => ({ semana: formatWeekLabel(w.week_start), count: w.count }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="semana" stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Bar dataKey="count" fill="#ef4444" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Comitês vs Outras (donut) */}
        <Card title="Reuniões de comitê" subtitle={`${comitePct}% contêm "Comitê" no título`}>
          <div className="h-64 flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.comite_pie}
                  innerRadius={62}
                  outerRadius={96}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  stroke="none"
                >
                  {data.comite_pie.map((_, i) => (
                    <Cell key={i} fill={COLORS_COMITE[i % COLORS_COMITE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-3xl font-black text-white">{comitePct}%</p>
                <p className="text-zinc-500 text-xs font-semibold">comitês</p>
              </div>
            </div>
          </div>
          <LegendList data={data.comite_pie} colors={COLORS_COMITE} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Ranking do mês */}
        <Card title="Ranking do mês" subtitle="Top 10 usuários com mais reuniões">
          <div className="space-y-2 py-1">
            {data.ranking_mes.length === 0 ? (
              <p className="text-zinc-600 text-sm italic py-8 text-center">
                Nenhuma reunião registrada neste mês ainda.
              </p>
            ) : (
              data.ranking_mes.map((r, i) => (
                <div
                  key={r.user_email}
                  className="flex items-center gap-3 px-3 py-2 bg-zinc-900/60 border border-zinc-800 rounded-xl"
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      i === 0
                        ? 'bg-red-600 text-white'
                        : i < 3
                          ? 'bg-red-600/20 text-red-400 border border-red-600/30'
                          : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-zinc-300 truncate">{formatUser(r.user_email)}</span>
                  <span className="text-sm font-bold text-white">{r.count}</span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Distribuição de status (donut) */}
        <Card title="Distribuição por status" subtitle="Todas as reuniões rastreadas">
          <div className="h-64 flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.status_dist.map((s) => ({ ...s, name: STATUS_LABELS[s.name] || s.name }))}
                  innerRadius={62}
                  outerRadius={96}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  stroke="none"
                >
                  {data.status_dist.map((_, i) => (
                    <Cell key={i} fill={COLORS_STATUS[i % COLORS_STATUS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-3xl font-black text-white">{data.total}</p>
                <p className="text-zinc-500 text-xs font-semibold">total</p>
              </div>
            </div>
          </div>
          <LegendList
            data={data.status_dist.map((s) => ({ ...s, name: STATUS_LABELS[s.name] || s.name }))}
            colors={COLORS_STATUS}
          />
        </Card>
      </div>

      {/* Artefatos disponíveis */}
      <Card title="Artefatos disponíveis" subtitle="Reuniões com cada tipo de artefato">
        <div className="grid grid-cols-3 gap-4 py-2">
          <ArtifactBar label="Gravação" count={data.artifacts_counts.recording} total={data.total} />
          <ArtifactBar label="Transcrição" count={data.artifacts_counts.transcript} total={data.total} />
          <ArtifactBar label="Anotações" count={data.artifacts_counts.smart_note} total={data.total} />
        </div>
      </Card>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#111111] border border-zinc-800 rounded-2xl px-5 py-4">
      <p className="text-xs font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">{label}</p>
      <p className="text-3xl font-black text-white">{value}</p>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111111] border border-zinc-800 rounded-2xl px-5 py-5">
      <div className="mb-4">
        <p className="text-sm font-bold text-white">{title}</p>
        {subtitle && <p className="text-zinc-500 text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function LegendList({ data, colors }: { data: { name: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((acc, d) => acc + d.value, 0) || 1;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
      {data.map((d, i) => (
        <div key={d.name} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: colors[i % colors.length] }} />
          <span className="text-zinc-400 font-medium">{d.name}</span>
          <span className="text-zinc-600">
            ({d.value} · {Math.round((d.value / total) * 100)}%)
          </span>
        </div>
      ))}
    </div>
  );
}

function ArtifactBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-zinc-400 text-xs font-semibold">{label}</p>
        <p className="text-white text-sm font-bold">
          {count} <span className="text-zinc-600 font-medium">/ {total}</span>
        </p>
      </div>
      <div className="h-2 bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden">
        <div className="h-full bg-red-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-zinc-600 text-[10px] font-semibold mt-1">{pct}%</p>
    </div>
  );
}
