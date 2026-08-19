import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { useAuth } from '../context/AuthContext.jsx';

const EVENT_ICON = { goal: '⚽', yellow: '🟨', red: '🟥', injury: '🚑', sub: '🔄', save: '🧤', half_time: '⏸', full_time: '🏁' };

export default function LiveMatchPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [notLive, setNotLive] = useState(null);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');
  const feedRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('match:join', { matchId: Number(id) });

    api.get(`/matches/${id}`).then((d) => {
      if (d.live) setState(d.state);
      else setNotLive(d.match);
    }).catch(() => {});

    const onState = (s) => { setState(s); setNotLive(null); };
    const onTick = (data) => {
      setState((prev) => prev ? { ...prev, minute: data.minute, half: data.half, homeScore: data.homeScore, awayScore: data.awayScore, stats: data.stats, possession: data.possession, subsUsed: data.subsUsed } : prev);
      if (data.event && data.event.text) {
        setFeed((f) => [...f.slice(-60), { minute: data.minute, ...data.event }]);
      }
    };
    const onFinished = (s) => { setState(s); };
    const onError = (e) => { setError(e.error); setTimeout(() => setError(''), 4000); };

    socket.on('match:state', onState);
    socket.on('match:tick', onTick);
    socket.on('match:finished', onFinished);
    socket.on('match:error', onError);

    return () => {
      socket.emit('match:leave', { matchId: Number(id) });
      socket.off('match:state', onState);
      socket.off('match:tick', onTick);
      socket.off('match:finished', onFinished);
      socket.off('match:error', onError);
    };
  }, [id]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [feed.length]);

  const kickoff = async () => {
    try { await api.post(`/matches/${id}/kickoff`); }
    catch (e) { setError(e.message); }
  };

  if (notLive) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <div className="font-display text-3xl text-chalk">{notLive.home_name} vs {notLive.away_name}</div>
        {notLive.status === 'finished' ? (
          <div className="font-display text-6xl text-turf">{notLive.home_score} – {notLive.away_score}</div>
        ) : (
          <>
            <div className="text-chalk-dim">Not kicked off yet.</div>
            {user && <button onClick={kickoff} className="px-5 py-2.5 rounded-md bg-turf text-ink font-semibold hover:bg-turf-dim">Kick off</button>}
          </>
        )}
        {error && <div className="text-crimson text-sm">{error}</div>}
      </div>
    );
  }

  if (!state) return <div className="text-chalk-dim">Loading match…</div>;

  const isHomeManager = user && ((user.role === 'admin' || user.role === 'owner') || user.teamId === state.homeTeam.id);
  const isAwayManager = user && ((user.role === 'admin' || user.role === 'owner') || user.teamId === state.awayTeam.id);

  return (
    <div className="space-y-6">
      <Scoreboard state={state} />
      {error && <div className="bg-crimson/10 border border-crimson/30 text-crimson text-sm rounded-md px-3 py-2">{error}</div>}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-surface border border-line rounded-lg p-4">
          <h3 className="text-xs uppercase tracking-widest text-chalk-dim mb-3">Live commentary</h3>
          <div ref={feedRef} className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {[...feed].reverse().map((e, i) => (
              <div key={i} className="flex gap-2 text-sm animate-slide-in">
                <span className="font-mono-tab text-chalk-dim w-9 shrink-0">{e.minute}'</span>
                <span className="shrink-0">{EVENT_ICON[e.type] || '·'}</span>
                <span className="text-chalk">{e.text}</span>
              </div>
            ))}
            {!feed.length && <div className="text-chalk-dim text-sm">Kickoff…</div>}
          </div>
        </div>

        <div className="space-y-4">
          {state.status === 'live' && isHomeManager && (
            <TacticsPanel matchId={id} side="home" label={state.homeTeam.name} state={state} />
          )}
          {state.status === 'live' && isAwayManager && (
            <TacticsPanel matchId={id} side="away" label={state.awayTeam.name} state={state} />
          )}
        </div>
      </div>
    </div>
  );
}

function Scoreboard({ state }) {
  const pct = state.possession || { home: 50, away: 50 };
  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden">
      <div className="px-6 py-5 flex items-center justify-between">
        <TeamBlock team={state.homeTeam} align="left" />
        <div className="text-center px-6">
          {state.status === 'live' && (
            <div className="flex items-center justify-center gap-1.5 text-gold text-xs font-bold uppercase tracking-widest mb-1">
              <span className="w-2 h-2 rounded-full bg-gold animate-live-dot" /> Live · {state.minute}'
            </div>
          )}
          {state.status === 'finished' && <div className="text-chalk-dim text-xs uppercase tracking-widest mb-1">Full time</div>}
          <div className="font-display text-6xl text-chalk leading-none">{state.homeScore} – {state.awayScore}</div>
          <div className="text-xs text-chalk-dim mt-1">{state.homeFormation} · {state.homeMentality} vs {state.awayFormation} · {state.awayMentality}</div>
        </div>
        <TeamBlock team={state.awayTeam} align="right" />
      </div>
      <div className="h-1.5 flex">
        <div className="bg-turf" style={{ width: `${pct.home}%` }} />
        <div className="bg-sky" style={{ width: `${pct.away}%` }} />
      </div>
      <div className="px-6 py-2 flex justify-between text-[11px] text-chalk-dim font-mono-tab">
        <span>Poss {pct.home}%</span>
        <span>Shots {state.stats.home.shots}-{state.stats.away.shots}</span>
        <span>Poss {pct.away}%</span>
      </div>
    </div>
  );
}

function TeamBlock({ team, align }) {
  return (
    <div className={`flex items-center gap-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <span className="w-4 h-4 rounded-full shrink-0" style={{ background: team.color }} />
      <span className="font-display text-2xl tracking-wide text-chalk">{team.name.toUpperCase()}</span>
    </div>
  );
}

function TacticsPanel({ matchId, side, label, state }) {
  const lineup = side === 'home' ? state.homeLineup : state.awayLineup;
  const bench = side === 'home' ? state.homeBench : state.awayBench;
  const formation = side === 'home' ? state.homeFormation : state.awayFormation;
  const mentality = side === 'home' ? state.homeMentality : state.awayMentality;
  const subsUsed = state.subsUsed[side];
  const [outId, setOutId] = useState('');
  const [inId, setInId] = useState('');

  const socket = getSocket();

  const changeTactics = (patch) => {
    socket.emit('tactics:update', { matchId: Number(matchId), side, formation, mentality, ...patch });
  };
  const makeSub = () => {
    if (!outId || !inId) return;
    socket.emit('sub:make', { matchId: Number(matchId), side, outId: Number(outId), inId: Number(inId) });
    setOutId(''); setInId('');
  };

  return (
    <div className="bg-surface border border-turf/40 rounded-lg p-4 space-y-4">
      <h3 className="text-xs uppercase tracking-widest text-turf">Managing {label}</h3>
      <div>
        <label className="block text-[11px] text-chalk-dim mb-1">Formation</label>
        <select value={formation} onChange={(e) => changeTactics({ formation: e.target.value })} className="w-full bg-ink-soft border border-line rounded px-2 py-1.5 text-sm">
          {state.formations.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] text-chalk-dim mb-1">Mentality</label>
        <select value={mentality} onChange={(e) => changeTactics({ mentality: e.target.value })} className="w-full bg-ink-soft border border-line rounded px-2 py-1.5 text-sm">
          {state.mentalities.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] text-chalk-dim mb-1">Substitution ({subsUsed}/{state.maxSubs} used)</label>
        <div className="space-y-1.5">
          <select value={outId} onChange={(e) => setOutId(e.target.value)} className="w-full bg-ink-soft border border-line rounded px-2 py-1.5 text-sm">
            <option value="">Off: choose player…</option>
            {lineup.filter((p) => !p.sentOff).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.position})</option>)}
          </select>
          <select value={inId} onChange={(e) => setInId(e.target.value)} className="w-full bg-ink-soft border border-line rounded px-2 py-1.5 text-sm">
            <option value="">On: choose player…</option>
            {bench.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.position})</option>)}
          </select>
          <button onClick={makeSub} disabled={subsUsed >= state.maxSubs || !outId || !inId}
            className="w-full py-1.5 rounded bg-turf text-ink text-sm font-semibold disabled:opacity-40">Make substitution</button>
        </div>
      </div>
    </div>
  );
}
