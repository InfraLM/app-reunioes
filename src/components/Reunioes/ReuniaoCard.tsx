import type { Reuniao } from '../../types';

const artifactConfig = [
  { key: 'link_gravacao', label: 'Gravação', color: 'text-green-400  bg-green-950/60  border-green-800/60' },
  { key: 'link_transcricao', label: 'Transcrição', color: 'text-blue-400   bg-blue-950/60   border-blue-800/60' },
  { key: 'link_anotacao', label: 'Anotações', color: 'text-purple-400 bg-purple-950/60 border-purple-800/60' },
  { key: 'ata_link_download', label: 'Ata', color: 'text-yellow-400 bg-yellow-950/60 border-yellow-800/60' },
] as const;

function DataRow({ label, value, valueClass = 'text-white' }: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm py-2.5">
      <span className="text-zinc-500 font-medium text-xs">{label}</span>
      <span className={`font-semibold text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}

function formatResponsavel(raw: string | null | undefined): string {
  if (!raw) return 'Não informado';
  const local = raw.includes('@') ? raw.split('@')[0] : raw;
  return local
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export default function ReuniaoCard({ reuniao, onClick }: { reuniao: Reuniao; onClick: () => void; }) {
  const formatDate = (date: string | null) => {
    if (!date) return 'Não informada';
    // Parseia apenas a parte da data (YYYY-MM-DD) como horário local para
    // evitar o shift de timezone ao tratar strings sem hora como UTC midnight.
    const [y, m, d] = date.split('T')[0].split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const participantes = reuniao.participantes_nomes
    ? reuniao.participantes_nomes.split(',').filter(Boolean)
    : [];

  const availableArtifacts = artifactConfig.filter(
    (a) => !!reuniao[a.key as keyof Reuniao]
  );

  return (
    <div
      onClick={onClick}
      className="group bg-[#111111] border border-zinc-800 hover:border-yellow-400/40 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-xl hover:shadow-yellow-400/10 active:scale-[0.98] select-none flex flex-col h-full"
    >
      {/* Card Header */}
      <div className="px-5 py-4 border-b border-zinc-800/60 flex items-start gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-zinc-800 group-hover:bg-yellow-400/10 border border-zinc-700 group-hover:border-yellow-400/20 flex items-center justify-center flex-shrink-0 transition-all duration-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 group-hover:text-yellow-400 transition-colors duration-200">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-bold text-sm leading-snug line-clamp-2 group-hover:text-yellow-50 transition-colors duration-200">
            {reuniao.titulo_reuniao || 'Reunião sem título'}
          </h3>
        </div>
        {availableArtifacts.length === 4 && (
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 flex-shrink-0 mt-1 shadow-sm shadow-green-400/50" title="Todos os artefatos disponíveis" />
        )}
      </div>

      {/* Card Body */}
      <div className="px-5 py-1 flex-grow divide-y divide-zinc-800/50">
        <DataRow label="Data" value={formatDate(reuniao.data_reuniao)} valueClass="text-zinc-300" />
        <DataRow label="Responsável" value={formatResponsavel(reuniao.responsavel)} valueClass="text-zinc-300" />
        {participantes.length > 0 && (
          <DataRow label="Participantes" value={participantes.length} valueClass="text-zinc-300" />
        )}
        <DataRow
          label="Gravação"
          value={reuniao.link_gravacao ? 'Disponível' : 'Indisponível'}
          valueClass={reuniao.link_gravacao ? 'text-green-400' : 'text-zinc-600'}
        />
      </div>

      {/* Card Footer */}
      {availableArtifacts.length > 0 && (
        <div className="px-5 py-3.5 border-t border-zinc-800/60 mt-auto">
          <div className="flex flex-wrap gap-2">
            {availableArtifacts.map((a) => (
              <span
                key={a.key}
                className={`px-3 py-1 text-xs font-semibold rounded-full border ${a.color}`}
              >
                {a.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
