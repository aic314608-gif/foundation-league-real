import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import StagePage from './pages/StagePage.jsx';
import TeamPage from './pages/TeamPage.jsx';
import PlayerPage from './pages/PlayerPage.jsx';
import LiveMatchPage from './pages/LiveMatchPage.jsx';
import MarketPage from './pages/MarketPage.jsx';
import AuctionPage from './pages/AuctionPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import LoginPage from './pages/LoginPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/stages/:id" element={<StagePage />} />
        <Route path="/teams/:id" element={<TeamPage />} />
        <Route path="/players/:id" element={<PlayerPage />} />
        <Route path="/matches/:id" element={<LiveMatchPage />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/auction" element={<AuctionPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
