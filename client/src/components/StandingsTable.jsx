import { Link } from 'react-router-dom';

export default function StandingsTable({ teams, promotionSpots = 0, relegationSpots = 0 }) {
  return (
    <div className="overflow-x-auto border border-line rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-chalk-dim text-xs uppercase tracking-wide border-b border-line">
            <th className="text-left px-3 py-2 w-8">#</th>
            <th className="text-left px-3 py-2">Club</th>
            <th className="text-right px-2 py-2 font-mono-tab">P</th>
            <th className="text-right px-2 py-2 font-mono-tab">W</th>
            <th className="text-right px-2 py-2 font-mono-tab">D</th>
            <th className="text-right px-2 py-2 font-mono-tab">L</th>
            <th className="text-right px-2 py-2 font-mono-tab">GD</th>
            <th className="text-right px-3 py-2 font-mono-tab">Pts</th>
            <th className="text-left px-3 py-2">Form</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t, i) => {
            const pos = i + 1;
            const played = t.wins + t.draws + t.losses;
            const promoZone = promotionSpots > 0 && pos <= promotionSpots;
            const relZone = relegationSpots > 0 && pos > teams.length - relegationSpots;
            return (
              <tr key={t.id} className="border-b border-line/60 last:border-0 hover:bg-surface-raised/60">
                <td className="px-3 py-2">
                  <span className={`inline-flex w-5 h-5 items-center justify-center rounded text-[11px] font-bold font-mono-tab
                    ${promoZone ? 'bg-gold/20 text-gold' : relZone ? 'bg-crimson/20 text-crimson' : 'text-chalk-dim'}`}>{pos}</span>
                </td>
                <td className="px-3 py-2">
                  <Link to={`/teams/${t.id}`} className="flex items-center gap-2 hover:text-turf">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                    <span className="font-medium">{t.name}</span>
                  </Link>
                </td>
                <td className="text-right px-2 py-2 font-mono-tab text-chalk-dim">{played}</td>
                <td className="text-right px-2 py-2 font-mono-tab">{t.wins}</td>
                <td className="text-right px-2 py-2 font-mono-tab text-chalk-dim">{t.draws}</td>
                <td className="text-right px-2 py-2 font-mono-tab text-chalk-dim">{t.losses}</td>
                <td className="text-right px-2 py-2 font-mono-tab text-chalk-dim">{t.goals_for - t.goals_against > 0 ? '+' : ''}{t.goals_for - t.goals_against}</td>
                <td className="text-right px-3 py-2 font-mono-tab font-bold text-chalk">{t.points}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {(t.form || []).slice(-5).map((r, idx) => (
                      <span key={idx} className={`w-4 h-4 rounded-sm text-[9px] flex items-center justify-center font-bold
                        ${r === 'W' ? 'bg-turf/25 text-turf' : r === 'L' ? 'bg-crimson/25 text-crimson' : 'bg-sky/25 text-sky'}`}>{r}</span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
