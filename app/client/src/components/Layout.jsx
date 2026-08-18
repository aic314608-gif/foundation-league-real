import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api.js';

const navItem = 'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stages, setStages] = useState([]);

  useEffect(() => {
    api.get('/stages').then((d) => setStages(d.stages)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex bg-ink text-chalk">
      <aside className="w-60 shrink-0 border-r border-line bg-ink-soft flex flex-col">
        <div className="px-5 py-5 border-b border-line">
          <div className="flex items-center gap-2">
            <svg width="26" height="26" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#0E1512" stroke="#2FBF71" strokeWidth="6" /><circle cx="50" cy="50" r="18" fill="none" stroke="#E8B84B" strokeWidth="4" /></svg>
            <div>
              <div className="font-display text-2xl leading-none text-chalk tracking-wide">FOUNDATION LEAGUE</div>
              <div className="text-[11px] text-chalk-dim uppercase tracking-widest">Est. Season 1</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink to="/" end className={({ isActive }) => `${navItem} ${isActive ? 'bg-turf/15 text-turf' : 'text-chalk-dim hover:bg-surface hover:text-chalk'}`}>
            Dashboard
          </NavLink>
          <div className="pt-3 pb-1 px-3 text-[11px] uppercase tracking-widest text-chalk-dim/70">Stages</div>
          {stages.map((s) => (
            <NavLink key={s.id} to={`/stages/${s.id}`} className={({ isActive }) => `${navItem} ${isActive ? 'bg-turf/15 text-turf' : 'text-chalk-dim hover:bg-surface hover:text-chalk'}`}>
              <span className="font-mono-tab text-xs text-chalk-dim/70">S{s.tier_order}</span> {s.name}
            </NavLink>
          ))}
          <div className="pt-3 pb-1 px-3 text-[11px] uppercase tracking-widest text-chalk-dim/70">League</div>
          <NavLink to="/market" className={({ isActive }) => `${navItem} ${isActive ? 'bg-turf/15 text-turf' : 'text-chalk-dim hover:bg-surface hover:text-chalk'}`}>Transfer Market</NavLink>
          <NavLink to="/auction" className={({ isActive }) => `${navItem} ${isActive ? 'bg-turf/15 text-turf' : 'text-chalk-dim hover:bg-surface hover:text-chalk'}`}>Auction Room</NavLink>
          {user?.teamId && (
            <NavLink to={`/teams/${user.teamId}`} className={({ isActive }) => `${navItem} ${isActive ? 'bg-turf/15 text-turf' : 'text-chalk-dim hover:bg-surface hover:text-chalk'}`}>My Club</NavLink>
          )}
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => `${navItem} ${isActive ? 'bg-gold/15 text-gold' : 'text-chalk-dim hover:bg-surface hover:text-gold'}`}>Admin Panel</NavLink>
          )}
        </nav>

        <div className="px-3 py-4 border-t border-line">
          {user ? (
            <div className="flex items-center justify-between px-2">
              <div>
                <div className="text-sm font-semibold text-chalk">{user.username}</div>
                <div className="text-[11px] uppercase tracking-wide text-chalk-dim">{user.role}</div>
              </div>
              <button onClick={async () => { await logout(); navigate('/login'); }} className="text-xs text-chalk-dim hover:text-crimson">Sign out</button>
            </div>
          ) : (
            <button onClick={() => navigate('/login')} className="w-full py-2 rounded-md bg-turf text-ink font-semibold text-sm hover:bg-turf-dim transition-colors">Sign in</button>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
