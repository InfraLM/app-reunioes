import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from '../components/Layout/Sidebar';
import HomePage from './Home';
import AoVivoPage from './Processamento';
import ReunioesPage from './Reunioes';
import RecentesPage from './EmAguardo';
import ChatIAPage from './ChatIA';
import StatusPage from './Status';

export default function Dashboard() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0a0a0a' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto' }}>
        <div className="max-w-[1280px] mx-auto px-6 sm:px-8 lg:px-10 py-10">
          <Routes>
            <Route path="home" element={<HomePage />} />
            <Route path="ao-vivo" element={<AoVivoPage />} />
            <Route path="reunioes" element={<ReunioesPage />} />
            <Route path="recentes" element={<RecentesPage />} />
            <Route path="chat-ia" element={<ChatIAPage />} />
            <Route path="status" element={<StatusPage />} />
            <Route path="*" element={<Navigate to="home" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
