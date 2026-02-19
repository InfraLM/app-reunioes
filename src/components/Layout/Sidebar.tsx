import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const navItems = [
  {
    path: '/app/processamento',
    label: 'Processamento',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
      </svg>
    ),
  },
  {
    path: '/app/reunioes',
    label: 'Reuniões',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14,2 14,8 20,8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    path: '/app/chat-ia',
    label: 'Chat IA',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(n => n[0]?.toUpperCase() ?? '').join('');
}

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside
      style={{ width: 256, minWidth: 256 }}
      className="sticky top-0 h-screen flex flex-col bg-[#111111] border-r border-zinc-800/80"
    >
      {/* ── Logo ── */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-zinc-800/80">
        <img src="/logo-branca.svg" alt="Meet Gov" className="h-7 w-auto" />
      </div>

      {/* ── User card ── */}
      {user && (
        <div className="px-5 py-4 border-b border-zinc-800/80">
          <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="w-9 h-9 rounded-full bg-yellow-400/15 border border-yellow-400/25 flex items-center justify-center shrink-0">
              <span className="text-yellow-400 text-xs font-bold">{getInitials(user.nome)}</span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate leading-tight">{user.nome}</p>
              {user.cargo && (
                <p className="text-zinc-500 text-xs font-medium mt-0.5 truncate">{user.cargo}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-[10px] font-semibold text-zinc-700 uppercase tracking-widest px-3 mb-3">
          MENU
        </p>
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-150 ${isActive
                ? 'bg-yellow-400 text-black'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'text-black' : 'text-zinc-500'}>{item.icon}</span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className="px-4 py-5 border-t border-zinc-800/80 space-y-4">
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-yellow-400 hover:bg-yellow-300 active:scale-[0.98] text-black text-sm font-bold rounded-xl transition-all duration-150 cursor-pointer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sair
        </button>

        <div className="px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
          <p className="text-zinc-600 text-[11px] font-medium">Sistema de Reuniões</p>
          <p className="text-zinc-400 text-xs font-semibold mt-0.5 truncate">reuniao.lmedu.com.br</p>
        </div>
      </div>
    </aside>
  );
}
