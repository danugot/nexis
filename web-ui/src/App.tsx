import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Chat from './components/Chat';
import GraphExplorer from './pages/GraphExplorer';
import AdminPage from './pages/AdminPage';
import KnowledgeBase from './pages/KnowledgeBase';

function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/graph" element={<GraphExplorer />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/kb" element={<KnowledgeBase />} />
        </Routes>
      </Layout>
    </HashRouter>
  )
}

export default App
