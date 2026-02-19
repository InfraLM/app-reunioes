import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login: authLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await authLogin(login, senha);
      navigate('/app/processamento');
    } catch (err: any) {
      const msg = err.response?.data?.error;
      setError(typeof msg === 'string' ? msg : 'Erro ao fazer login. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#0a0a0a]">

      {/* Left panel – branding */}
      <div className="hidden lg:flex flex-col justify-between w-[52%] bg-[#111111] border-r border-zinc-800 px-16 py-16">

        {/* Logo */}
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" fill="#0a0a0a" />
            </svg>
          </div>
          <span className="text-white font-black text-xl tracking-tight">Meet LM</span>
        </div>

        {/* Headline */}
        <div className="max-w-lg">
          <p className="text-zinc-500 text-xs uppercase tracking-[0.25em] font-semibold mb-8">
            Gestão de Governança
          </p>
          <h2 className="text-5xl font-black text-white leading-[1.1] mb-10 tracking-tight">
            Reuniões.<br />
            <span className="text-yellow-400">Processadas.</span><br />
            Automaticamente.
          </h2>
          <p className="text-zinc-400 text-base leading-relaxed">
            Monitoramento em tempo real de conferências Google Meet com geração automática de atas, transcrições e gravações.
          </p>
        </div>

        {/* Stats */}
        <div className="flex gap-14">
          {[
            { value: '30min', label: 'Timeout máximo' },
            { value: '3', label: 'Artefatos por reunião' },
            { value: 'Auto', label: 'Webhook dispatch' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-yellow-400 text-3xl font-black tracking-tight">{stat.value}</p>
              <p className="text-zinc-600 text-xs mt-2.5 font-medium">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel – login form */}
      <div className="flex-1 flex items-center justify-center px-10 py-16">
        <div className="w-full max-w-[420px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-14 lg:hidden">
            <div className="w-9 h-9 bg-yellow-400 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" fill="#0a0a0a" />
              </svg>
            </div>
            <span className="text-white font-black text-lg">Meet Gov</span>
          </div>

          {/* Heading */}
          <div className="mb-12">
            <h1 className="text-4xl font-black text-white mb-4 tracking-tight">Bem-vindo</h1>
            <p className="text-zinc-500 text-base font-normal leading-relaxed">
              Entre com suas credenciais para acessar o painel.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-7">

            {/* Usuário */}
            <div className="flex flex-col gap-3">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-[0.18em]">
                Usuário
              </label>
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                className="w-full px-5 py-4 bg-[#111111] border border-zinc-800 rounded-xl text-white placeholder-zinc-700 focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20 transition-all duration-200 text-sm font-medium hover:border-zinc-700"
                placeholder="Digite seu usuário"
                required
                autoFocus
              />
            </div>

            {/* Senha */}
            <div className="flex flex-col gap-3">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-[0.18em]">
                Senha
              </label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full px-5 py-4 bg-[#111111] border border-zinc-800 rounded-xl text-white placeholder-zinc-700 focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20 transition-all duration-200 text-sm font-medium hover:border-zinc-700"
                placeholder="Digite sua senha"
                required
              />
            </div>

            {/* Error */}
            {error && (
              <div className="px-5 py-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-400 text-sm font-medium leading-relaxed">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-8 py-4 bg-yellow-400 hover:bg-yellow-300 active:scale-[0.99] disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-black font-bold rounded-xl transition-all duration-150 text-base tracking-wide whitespace-nowrap cursor-pointer select-none shadow-lg shadow-yellow-400/10 hover:shadow-yellow-400/25 hover:shadow-xl mt-2"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-zinc-700 text-xs mt-12 font-medium">
            reuniao.lmedu.com.br
          </p>
        </div>
      </div>
    </div>
  );
}
