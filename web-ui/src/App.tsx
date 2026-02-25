import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Chat from './components/Chat';
import GraphExplorer from './pages/GraphExplorer';
import AdminPage from './pages/AdminPage';
import KnowledgeBase from './pages/KnowledgeBase';
import { GlobalDomainProvider } from './contexts/GlobalDomainContext';

function App() {
  return (
    <HashRouter>
      <GlobalDomainProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Chat />} />
            <Route path="/graph" element={<GraphExplorer />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/kb" element={<KnowledgeBase />} />
          </Routes>
        </Layout>
      </GlobalDomainProvider>
    </HashRouter>
  )
}

export default App
