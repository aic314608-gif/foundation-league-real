import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const CATEGORY_COLOR = {
  transfer: 'text-sky', contract: 'text-turf', sponsor: 'text-gold',
  youth: 'text-turf', retirement: 'text-crimson', league: 'text-chalk', development: 'text-sky',
};

export default function Dashboard() {
  const [stages, setStages] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/stages'),
      api.get('/news'),
    ]).then(async ([stageData, newsData]) => {
      const detailed = await Promise.all(stageData.stages.map((s) => api.get(`/stages/${s.id}`)));
      setStages(detailed);
      setNews(newsData.news);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-chalk-dim">Loading league…</div>;

  if (!stages.length) {
    return (
      <div className="text-center py-24">
        <div className="font-display text-3xl text-chalk mb-2">NO LEAGUE YET</div>
        <p className="text-chalk-dim mb-4">An admin needs to reset the league to generate the world before anything else can happen.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-4xl text-chalk tracking-wide">DASHBOARD</h1>
        <p className="text-chalk-dim text-sm">Season {stages[0]?.stage?.season ?? 1} across three stages.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {stages.map((s) => (
          <div key={s.stage.id} className="bg-surface border border-line rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-chalk-dim">Stage {s.stage.tier_order}</div>
                <div className="font-display text-xl text-chalk tracking-wide">{s.stage.name}</div>
              </div>
              <Link to={`/stages/${s.stage.id}`} className="text-xs text-turf hover:underline">Full table →</Link>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {s.standings.slice(0, 5).map((t, i) => (
                  <tr key={t.id} className="border-b border-line/50 last:border-0">
                    <td className="px-4 py-1.5 w-6 font-mono-tab text-chalk-dim text-xs">{i + 1}</td>
                    <td className="py-1.5">
                      <Link to={`/teams/${t.id}`} className="flex items-center gap-2 hover:text-turf">
                        <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono-tab font-bold">{t.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div>
        <h2 className="font-display text-2xl text-chalk tracking-wide mb-3">LEAGUE WIRE</h2>
        <div className="bg-surface border border-line rounded-lg divide-y divide-line">
          {news.length === 0 && <div className="px-4 py-6 text-chalk-dim text-sm text-center">No news yet — action in the league will show up here.</div>}
          {news.map((n) => (
            <div key={n.id} className="px-4 py-3 flex items-start gap-3">
              <span className={`text-[10px] uppercase tracking-widest font-bold mt-0.5 shrink-0 w-20 ${CATEGORY_COLOR[n.category] || 'text-chalk-dim'}`}>{n.category}</span>
              <span className="text-sm text-chalk">{n.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
