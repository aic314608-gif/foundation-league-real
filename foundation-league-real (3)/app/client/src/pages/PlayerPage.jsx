import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import AttributeBars from '../components/AttributeBars.jsx';

const CARD_LABEL = { hero: 'Hero', legend: 'Icon', special: 'Special' };

export default function PlayerPage() {
  const { id } = useParams();
  const [player, setPlayer] = useState(null);

  useEffect(() => {
    api.get(`/players/${id}`).then((d) => setPlayer(d.player)).catch(() => {});
  }, [id]);

  if (!player) return <div className="text-chalk-dim">Loading…</div>;

  const overall = Math.round(
    (player.pace + player.shooting + player.passing + player.dribbling + player.defending + player.physical) / 6,
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          {player.card_type && (
            <span className="inline-block text-[10px] uppercase tracking-widest font-bold text-gold bg-gold/15 px-2 py-0.5 rounded mb-2">
              {CARD_LABEL[player.card_type]}
            </span>
          )}
          <h1 className="font-display text-4xl text-chalk tracking-wide">{player.name.toUpperCase()}</h1>
          <div className="text-chalk-dim text-sm mt-1">
            {player.position} · {player.age} yrs · {player.nationality}
            {player.team_name && (
              <> · <Link to={`/teams/${player.team_id}`} className="text-turf hover:underline">{player.team_name}</Link></>
            )}
            {!player.team_id && <span className="text-sky"> · Free agent</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-5xl text-turf leading-none">{player.position === 'GK' ? player.goalkeeping : overall}</div>
          <div className="text-[11px] uppercase tracking-widest text-chalk-dim">Overall</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Star Rating" value={`${player.star_rating ?? '—'}★`} />
        <Stat label="Potential" value={player.potential} />
        <Stat label="Form" value={player.form} />
        <Stat label="Morale" value={player.morale} />
        <Stat label="Fitness" value={`${player.fitness}%`} />
        <Stat label="Wage" value={`$${Number(player.wage).toLocaleString()}`} />
        <Stat label="Contract" value={player.contract_seasons_left >= 99 ? 'Permanent' : `${player.contract_seasons_left} season(s)`} />
        <Stat label="Value" value={player.market_value ? `$${Number(player.market_value).toLocaleString()}` : '—'} />
      </div>

      {player.injury_status === 'Injured' && (
        <div className="bg-crimson/10 border border-crimson/30 text-crimson text-sm rounded-md px-3 py-2">
          Injured — expected back in {player.injury_matches_remaining} match{player.injury_matches_remaining === 1 ? '' : 'es'}.
        </div>
      )}
      {player.wants_to_leave && (
        <div className="bg-gold/10 border border-gold/30 text-gold text-sm rounded-md px-3 py-2">
          This player has expressed a desire to leave the club.
        </div>
      )}

      <div className="bg-surface border border-line rounded-lg p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim mb-4">Attributes <span className="normal-case font-normal">(tap a category to see its sub-stats)</span></h2>
        <AttributeBars player={player} isGoalkeeper={player.position === 'GK'} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Appearances" value={player.appearances} />
        <Stat label="Goals" value={player.goals} />
        <Stat label="Assists" value={player.assists} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-surface border border-line rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-chalk-dim">{label}</div>
      <div className="font-mono-tab text-lg text-chalk">{value}</div>
    </div>
  );
}
