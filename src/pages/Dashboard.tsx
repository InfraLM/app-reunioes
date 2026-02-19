import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from '../components/Layout/Sidebar';
import ProcessamentoPage from './Processamento';
import ReunioesPage from './Reunioes';
import ChatIAPage from './ChatIA';

export default function Dashboard() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0a0a0a' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto' }}>
        <div className="max-w-[1280px] mx-auto px-6 sm:px-8 lg:px-10 py-10">
          <Routes>
            <Route path="processamento" element={<ProcessamentoPage />} />
            <Route path="reunioes" element={<ReunioesPage />} />
            <Route path="chat-ia" element={<ChatIAPage />} />
            <Route path="*" element={<Navigate to="reunioes" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
