import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import StandingsTable from '../components/StandingsTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function StagePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('table');
  const [busyMatchday, setBusyMatchday] = useState(null);

  const load = useCallback(() => {
    api.get(`/stages/${id}`).then(setData).catch(() => {});
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="text-chalk-dim">Loading…</div>;

  const { stage, standings, matches } = data;
  const byMatchday = matches.reduce((acc, m) => {
    (acc[m.matchday] = acc[m.matchday] || []).push(m);
    return acc;
  }, {});

  const simulateMatchday = async (md) => {
    setBusyMatchday(md);
    try {
      await api.post(`/admin/matchday/${stage.id}/${md}/simulate-all`);
      load();
    } catch { /* ignore, likely not admin */ }
    setBusyMatchday(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-chalk-dim">Stage {stage.tier_order} · Season {stage.season}</div>
        <h1 className="font-display text-4xl text-chalk tracking-wide">{stage.name.toUpperCase()}</h1>
      </div>

      <div className="flex gap-1 bg-surface border border-line rounded-md p-1 w-fit">
        <button onClick={() => setTab('table')} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === 'table' ? 'bg-turf text-ink' : 'text-chalk-dim'}`}>Table</button>
        <button onClick={() => setTab('fixtures')} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === 'fixtures' ? 'bg-turf text-ink' : 'text-chalk-dim'}`}>Fixtures</button>
      </div>

      {tab === 'table' && (
        <StandingsTable teams={standings} promotionSpots={stage.promotion_spots} relegationSpots={stage.relegation_spots} />
      )}

      {tab === 'fixtures' && (
        <div className="space-y-5">
          {Object.keys(byMatchday).sort((a, b) => a - b).map((md) => (
            <div key={md}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-chalk-dim uppercase tracking-wide">Matchday {md}</h3>
                {user?.role === 'admin' && (
                  <button onClick={() => simulateMatchday(md)} disabled={busyMatchday === md}
                    className="text-xs px-2 py-1 rounded bg-surface-raised border border-line hover:border-turf text-chalk-dim hover:text-turf disabled:opacity-50">
                    {busyMatchday === md ? 'Starting…' : 'Kick off whole matchday'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {byMatchday[md].map((m) => (
                  <Link key={m.id} to={`/matches/${m.id}`}
                    className="flex items-center justify-between bg-surface border border-line rounded-md px-3 py-2 hover:border-turf transition-colors">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="w-2 h-2 rounded-full" style={{ background: m.home_color }} />
                      {m.home_name}
                    </span>
                    <span className="font-mono-tab text-sm px-2">
                      {m.status === 'finished' ? `${m.home_score} – ${m.away_score}` : m.status === 'live' ? <span className="text-gold">● LIVE</span> : 'vs'}
                    </span>
                    <span className="flex items-center gap-2 text-sm">
                      {m.away_name}
                      <span className="w-2 h-2 rounded-full" style={{ background: m.away_color }} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {!matches.length && <div className="text-chalk-dim text-sm">No fixtures yet — an admin needs to generate them.</div>}
        </div>
      )}
    </div>
  );
}
