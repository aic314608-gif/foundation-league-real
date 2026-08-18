import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function MarketPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('listed');
  const [players, setPlayers] = useState([]);
  const [offers, setOffers] = useState({ incoming: [], outgoing: [] });
  const [msg, setMsg] = useState('');
  const [amounts, setAmounts] = useState({});

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

  const loadPlayers = useCallback(() => {
    const q = tab === 'listed' ? '?listed=true' : '?freeAgents=true';
    api.get(`/players${q}`).then((d) => setPlayers(d.players)).catch(() => {});
  }, [tab]);

  const loadOffers = useCallback(() => {
    if (!user) return;
    api.get('/market/transfer-offers').then((d) => {
      setOffers({
        incoming: d.offers.filter((o) => o.to_team_id === user.teamId && o.status === 'pending'),
        outgoing: d.offers.filter((o) => o.from_team_id === user.teamId),
      });
    }).catch(() => {});
  }, [user]);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);
  useEffect(() => { loadOffers(); }, [loadOffers]);

  const makeOffer = async (playerId) => {
    const amount = Number(amounts[playerId]);
    if (!amount) return flash('Enter an offer amount first.');
    try {
      const r = await api.post(`/market/players/${playerId}/offer`, { amount });
      flash(r.auto ? `Offer auto-${r.status}: ${r.reason || ''}` : 'Offer sent — awaiting a response.');
      loadOffers();
    } catch (e) { flash(e.message); }
  };

  const signFreeAgent = async (playerId) => {
    const amount = Number(amounts[playerId]) || 0;
    try {
      const r = await api.post(`/market/players/${playerId}/contract`, { wage: amount, seasons: 3 });
      flash(r.accepted ? 'Signed!' : `Player declined: ${r.reason}`);
      loadPlayers();
    } catch (e) { flash(e.message); }
  };

  const respond = async (offerId, decision) => {
    try { await api.post(`/market/offers/${offerId}/respond`, { decision }); flash(`Offer ${decision}.`); loadOffers(); loadPlayers(); }
    catch (e) { flash(e.message); }
  };

  const overall = (p) => p.position === 'GK' ? p.goalkeeping : Math.round((p.pace + p.shooting + p.passing + p.dribbling + p.defending + p.physical) / 6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl text-chalk tracking-wide">TRANSFER MARKET</h1>
        <p className="text-chalk-dim text-sm">Browse listed players and free agents. Icons/Heroes/Specials never appear here.</p>
      </div>

      {msg && <div className="bg-surface border border-gold/40 text-gold text-sm rounded-md px-3 py-2">{msg}</div>}

      {user?.teamId && (offers.incoming.length > 0) && (
        <div className="bg-surface border border-gold/40 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gold uppercase tracking-wide">Incoming offers</h3>
          {offers.incoming.map((o) => (
            <div key={o.id} className="flex items-center justify-between bg-ink-soft rounded px-3 py-2 text-sm">
              <span>{o.from_team_name} offers ${Number(o.amount).toLocaleString()} for {o.player_name}</span>
              <div className="flex gap-2">
                <button onClick={() => respond(o.id, 'accept')} className="text-xs px-2 py-1 rounded bg-turf/20 text-turf">Accept</button>
                <button onClick={() => respond(o.id, 'reject')} className="text-xs px-2 py-1 rounded bg-crimson/20 text-crimson">Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 bg-surface border border-line rounded-md p-1 w-fit">
        <button onClick={() => setTab('listed')} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === 'listed' ? 'bg-turf text-ink' : 'text-chalk-dim'}`}>Listed</button>
        <button onClick={() => setTab('free')} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === 'free' ? 'bg-turf text-ink' : 'text-chalk-dim'}`}>Free Agents</button>
      </div>

      <div className="border border-line rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-chalk-dim text-xs uppercase tracking-wide border-b border-line bg-surface">
              <th className="text-left px-3 py-2">Player</th>
              <th className="text-left px-3 py-2">Club</th>
              <th className="text-right px-3 py-2 font-mono-tab">OVR</th>
              <th className="text-right px-3 py-2 font-mono-tab">Value</th>
              {user?.teamId && <th className="text-right px-3 py-2">Action</th>}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className="border-b border-line/50 last:border-0 hover:bg-surface-raised/60">
                <td className="px-3 py-2"><Link to={`/players/${p.id}`} className="hover:text-turf font-medium">{p.name}</Link> <span className="text-chalk-dim text-xs">{p.position}</span></td>
                <td className="px-3 py-2 text-chalk-dim">{p.team_name || 'Free agent'}</td>
                <td className="px-3 py-2 text-right font-mono-tab">{overall(p)}</td>
                <td className="px-3 py-2 text-right font-mono-tab">{p.asking_price ? `$${Number(p.asking_price).toLocaleString()} ask` : `$${Number(p.market_value).toLocaleString()}`}</td>
                {user?.teamId && (
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <input placeholder={tab === 'listed' ? 'Offer $' : 'Wage $'} value={amounts[p.id] || ''} onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })}
                        className="w-24 bg-ink-soft border border-line rounded px-2 py-1 text-xs font-mono-tab" />
                      <button onClick={() => tab === 'listed' ? makeOffer(p.id) : signFreeAgent(p.id)} className="text-xs px-2 py-1 rounded bg-turf/20 text-turf hover:bg-turf/30">
                        {tab === 'listed' ? 'Offer' : 'Sign'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!players.length && <div className="text-chalk-dim text-sm text-center py-6">Nothing here right now.</div>}
      </div>
    </div>
  );
}
