import type { Reuniao } from '../../types';

interface Props {
  reuniao: Reuniao;
  onClose: () => void;
}

/** maria.julia@empresa.com → "Maria Julia" */
function formatResponsavel(raw: string | null | undefined): string {
  if (!raw) return '—';
  const local = raw.includes('@') ? raw.split('@')[0] : raw;
  return local
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-zinc-600 flex-shrink-0">{icon}</span>
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.15em]">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function ArtifactLink({
  href,
  label,
  color,
  isDownload = false,
  downloadFileName,
}: {
  href: string;
  label: string;
  color: string;
  isDownload?: boolean;
  downloadFileName?: string;
}) {
  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(href);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = downloadFileName || 'ata.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao baixar o arquivo:', error);
      // Fallback: abre em nova aba se o download falhar
      window.open(href, '_blank');
    }
  };

  if (isDownload) {
    return (
      <button
        onClick={handleDownload}
        className={`inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold border transition-all duration-150 whitespace-nowrap cursor-pointer hover:opacity-80 active:scale-[0.97] ${color}`}
      >
        {label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold border transition-all duration-150 whitespace-nowrap cursor-pointer hover:opacity-80 active:scale-[0.97] ${color}`}
    >
      {label}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
}

export default function ReuniaoModal({ reuniao, onClose }: Props) {
  const parseArray = (str: string | null) =>
    str
      ? str
          .split(',')
          .filter(Boolean)
          .map((s) => s.trim())
      : [];

  const participantesNomes = parseArray(reuniao.participantes_nomes);
  const itensPauta = parseArray(reuniao.itens_pauta_titulos);
  const deliberacoes = parseArray(reuniao.deliberacoes_titulos);
  const acoes = parseArray(reuniao.acoes_lista);
  const responsaveis = parseArray(reuniao.acoes_responsaveis);

  // Cria um nome de arquivo baseado no título da reunião e data
  const getAtaFileName = () => {
    const titulo = reuniao.titulo_reuniao
      ? reuniao.titulo_reuniao.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 50)
      : 'reuniao';
    const data = reuniao.data_reuniao
      ? reuniao.data_reuniao.split('T')[0]
      : '';
    return `ata_${titulo}${data ? `_${data}` : ''}.pdf`;
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6"
      onClick={onClose}
    >
      <div
        className="bg-[#111111] border border-zinc-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start px-8 py-6 border-b border-zinc-800 flex-shrink-0">
          <div className="flex-1 pr-6">
            <p className="text-xs text-zinc-600 font-bold uppercase tracking-[0.15em] mb-2">
              Detalhes da Reunião
            </p>
            <h2 className="text-xl font-black text-white leading-snug tracking-tight">
              {reuniao.titulo_reuniao || 'Reunião sem título'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-2.5 text-zinc-600 hover:text-white hover:bg-zinc-800 rounded-xl transition-all duration-150 cursor-pointer select-none"
            title="Fechar"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-8 py-7 space-y-8">

          {/* Informações básicas */}
          <Section
            title="Informações"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            }
          >
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  label: 'Data',
                  value: (() => {
                    if (!reuniao.data_reuniao) return '—';
                    const [y, m, d] = reuniao.data_reuniao.split('T')[0].split('-').map(Number);
                    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
                      day: '2-digit', month: 'long', year: 'numeric',
                    });
                  })(),
                },
                {
                  label: 'Horário',
                  value:
                    reuniao.hora_inicio && reuniao.hora_fim
                      ? `${reuniao.hora_inicio} – ${reuniao.hora_fim}`
                      : '—',
                },
                {
                  label: 'Responsável',
                  value: formatResponsavel(reuniao.responsavel),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="bg-[#0a0a0a] border border-zinc-800 rounded-xl px-5 py-4"
                >
                  <p className="text-xs text-zinc-600 font-medium mb-1.5">{item.label}</p>
                  <p className="text-white font-semibold text-sm">{item.value}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Artefatos */}
          <Section
            title="Artefatos"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            }
          >
            <div className="flex flex-wrap gap-2.5">
              {reuniao.link_gravacao && (
                <ArtifactLink href={reuniao.link_gravacao} label="Gravação"     color="text-green-400  bg-green-950/60  border-green-800  hover:bg-green-900/50"  />
              )}
              {reuniao.link_transcricao && (
                <ArtifactLink href={reuniao.link_transcricao} label="Transcrição" color="text-blue-400   bg-blue-950/60   border-blue-800   hover:bg-blue-900/50"   />
              )}
              {reuniao.link_anotacao && (
                <ArtifactLink href={reuniao.link_anotacao} label="Anotações"   color="text-purple-400 bg-purple-950/60 border-purple-800 hover:bg-purple-900/50" />
              )}
              {reuniao.ata_link_download && (
                <ArtifactLink href={reuniao.ata_link_download} label="Ata"      color="text-yellow-400 bg-yellow-950/60 border-yellow-800 hover:bg-yellow-900/50" isDownload downloadFileName={getAtaFileName()} />
              )}
              {!reuniao.link_gravacao &&
                !reuniao.link_transcricao &&
                !reuniao.link_anotacao &&
                !reuniao.ata_link_download && (
                  <p className="text-zinc-600 text-sm font-medium">Nenhum artefato disponível.</p>
                )}
            </div>
          </Section>

          {/* Participantes */}
          {participantesNomes.length > 0 && (
            <Section
              title={`Participantes (${participantesNomes.length})`}
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
            >
              <div className="flex flex-wrap gap-2">
                {participantesNomes.map((nome, i) => (
                  <span
                    key={i}
                    className="px-3.5 py-1.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-full text-xs font-medium"
                  >
                    {nome}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Objetivo */}
          {reuniao.objetivo_reuniao && (
            <Section
              title="Objetivo"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
                </svg>
              }
            >
              <div className="bg-[#0a0a0a] border border-zinc-800 rounded-xl px-5 py-4">
                <p className="text-zinc-400 text-sm leading-relaxed whitespace-pre-wrap font-normal">
                  {reuniao.objetivo_reuniao}
                </p>
              </div>
            </Section>
          )}

          {/* Pauta */}
          {itensPauta.length > 0 && (
            <Section
              title="Pauta"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              }
            >
              <ul className="space-y-2.5">
                {itensPauta.map((item, i) => (
                  <li key={i} className="flex items-start gap-4 text-sm text-zinc-400 font-normal">
                    <span className="text-yellow-400 font-black text-xs mt-0.5 flex-shrink-0 w-5">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Deliberações */}
          {deliberacoes.length > 0 && (
            <Section
              title="Deliberações"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              }
            >
              <ul className="space-y-2.5">
                {deliberacoes.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-zinc-400 font-normal">
                    <span className="text-green-400 flex-shrink-0 mt-0.5">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Ações */}
          {acoes.length > 0 && (
            <Section
              title="Ações"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              }
            >
              <ul className="space-y-2.5">
                {acoes.map((acao, i) => (
                  <li
                    key={i}
                    className="bg-[#0a0a0a] border border-zinc-800 rounded-xl px-5 py-4"
                  >
                    <p className="text-white text-sm font-semibold">{acao}</p>
                    {responsaveis[i] && (
                      <p className="text-zinc-600 text-xs mt-1.5 font-normal">
                        Responsável:{' '}
                        <span className="text-zinc-400 font-medium">{responsaveis[i]}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Próximas Etapas */}
          {reuniao.proximas_etapas && (
            <Section
              title="Próximas Etapas"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              }
            >
              <div className="bg-[#0a0a0a] border border-zinc-800 rounded-xl px-5 py-4">
                <p className="text-zinc-400 text-sm leading-relaxed whitespace-pre-wrap font-normal">
                  {reuniao.proximas_etapas}
                </p>
              </div>
            </Section>
          )}

          {/* Resumo Executivo */}
          {reuniao.resumo_executivo && (
            <Section
              title="Resumo Executivo"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
                </svg>
              }
            >
              <div className="bg-[#0a0a0a] border border-zinc-800 rounded-xl px-5 py-4">
                <p className="text-zinc-400 text-sm leading-relaxed whitespace-pre-wrap font-normal">
                  {reuniao.resumo_executivo}
                </p>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
