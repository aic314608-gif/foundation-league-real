import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuctionPage() {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'idle' });
  const [bidAmount, setBidAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState([]);
  const [selectedStageId, setSelectedStageId] = useState(null);
  const [selectedLotType, setSelectedLotType] = useState('player');

  const loadStages = () => {
    if ((user?.role === 'admin' || user?.role === 'owner')) api.get('/auction/stages').then((d) => setStages(d.stages)).catch(() => {});
  };

  useEffect(() => {
    if (stages.length && !stages.some((s) => s.id === selectedStageId)) setSelectedStageId(stages[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages]);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('auction:join');
    api.get('/auction').then(setState).catch(() => {});
    loadStages();

    const onState = (s) => setState(s);
    const onError = (e) => { setError(e.error); setTimeout(() => setError(''), 3500); };
    socket.on('auction:state', onState);
    socket.on('auction:error', onError);
    socket.on('auction:completed', () => { api.get('/auction').then(setState); loadStages(); });
    return () => {
      socket.emit('auction:leave');
      socket.off('auction:state', onState);
      socket.off('auction:error', onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  const start = async (stageId, lotType = 'player') => {
    setBusy(true);
    try { await api.post('/auction/start', { ...(stageId ? { stageId } : {}), lotType }); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const autofill = async () => {
    setBusy(true);
    try { await api.post('/auction/autofill'); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const pause = async () => {
    setBusy(true);
    try { await api.post('/auction/pause'); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const resume = async () => {
    setBusy(true);
    try { await api.post('/auction/resume'); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const bid = () => {
    const socket = getSocket();
    socket.emit('auction:bid', { amount: Number(bidAmount) });
    setBidAmount('');
  };
  const quickBid = (increment) => {
    const socket = getSocket();
    const base = Number(state.currentBid) || 0;
    socket.emit('auction:bid', { amount: base + increment });
  };

  const timeLeft = state.status === 'paused'
    ? Math.max(0, Math.round((state.pausedRemainingMs || 0) / 1000))
    : state.deadline ? Math.max(0, Math.round((state.deadline - Date.now()) / 1000)) : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-4xl text-chalk tracking-wide">AUCTION ROOM</h1>
        <p className="text-chalk-dim text-sm">One player up at a time, soft-close bidding. Squads need at least 11 fit players to kick off.</p>
      </div>

      {error && <div className="bg-crimson/10 border border-crimson/30 text-crimson text-sm rounded-md px-3 py-2">{error}</div>}

      {(user?.role === 'admin' || user?.role === 'owner') && (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-widest text-chalk-dim">Run in order, per tier: Manager auction → Player auction. Elite → Rise → Foundation.</div>

          {(() => {
            const locked = busy || state.status === 'active' || state.status === 'paused';
            const activeStage = stages.find((s) => s.id === selectedStageId);
            return (
              <>
                {stages.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-chalk-dim mb-1">Division</div>
                    <div className="flex flex-wrap gap-2">
                      {stages.map((s) => (
                        <button key={s.id} onClick={() => setSelectedStageId(s.id)} disabled={locked}
                          className={`px-4 py-2 rounded-md border text-sm font-semibold disabled:opacity-40 ${selectedStageId === s.id ? 'bg-gold text-ink border-gold' : 'bg-surface-raised border-line text-chalk-dim hover:text-chalk'}`}>
                          {s.name}{s.completed && s.coachesCompleted ? ' ✓' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[11px] uppercase tracking-widest text-chalk-dim mb-1">Lot type</div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setSelectedLotType('coach')} disabled={locked}
                      className={`px-4 py-2 rounded-md border text-sm font-semibold disabled:opacity-40 ${selectedLotType === 'coach' ? 'bg-gold text-ink border-gold' : 'bg-surface-raised border-gold text-gold'}`}>
                      Managers{activeStage?.coachesCompleted ? ' ✓' : ''}
                    </button>
                    <button onClick={() => setSelectedLotType('player')} disabled={locked}
                      className={`px-4 py-2 rounded-md border text-sm font-semibold disabled:opacity-40 ${selectedLotType === 'player' ? 'bg-gold text-ink border-gold' : 'bg-surface-raised border-line text-turf'}`}>
                      Players{activeStage?.completed ? ' ✓' : ''}
                    </button>
                  </div>
                </div>

                <button onClick={() => start(selectedStageId, selectedLotType)}
                  disabled={locked || (stages.length > 0 && selectedStageId === null)}
                  className="px-6 py-2 rounded-md bg-turf text-ink font-bold text-sm disabled:opacity-40">
                  Start Auction
                </button>
              </>
            );
          })()}

          {(state.status === 'active' || state.status === 'paused') && (
            <div className="flex flex-wrap gap-2">
              {state.status === 'active' && (
                <button onClick={pause} disabled={busy} className="px-4 py-2 rounded-md bg-surface-raised border border-line text-chalk-dim hover:text-chalk hover:border-chalk-dim text-sm">Pause auction</button>
              )}
              {state.status === 'paused' && (
                <button onClick={resume} disabled={busy} className="px-4 py-2 rounded-md bg-gold text-ink font-semibold text-sm hover:brightness-110">Resume auction</button>
              )}
              <button onClick={autofill} disabled={busy} className="px-4 py-2 rounded-md bg-surface-raised border border-line text-chalk-dim hover:text-gold hover:border-gold text-sm">Auto-fill remaining ({state.queueRemaining})</button>
            </div>
          )}
        </div>
      )}

      {state.status !== 'active' && state.status !== 'paused' && (
        <div className="bg-surface border border-line rounded-lg p-10 text-center text-chalk-dim">
          {state.status === 'completed' ? `Auction complete — ${state.soldCount} sold, ${state.unsoldCount} unsold.` : 'No auction in progress.'}
        </div>
      )}

      {(state.status === 'active' || state.status === 'paused') && state.currentPlayer && (
        <div className={`bg-surface border rounded-lg p-6 space-y-5 ${state.status === 'paused' ? 'border-gold' : 'border-line'}`}>
          {state.status === 'paused' && (
            <div className="text-xs uppercase tracking-widest text-gold font-semibold">⏸ Auction paused — bidding is on hold</div>
          )}
          {state.stageName && (
            <div className="text-xs uppercase tracking-widest text-gold">
              {state.stageName} {state.lotType === 'coach' ? 'manager' : 'player'} auction — clubs from this division only
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-3xl text-chalk">{state.currentPlayer.name}</div>
              {state.lotType === 'coach' ? (
                <div className="text-chalk-dim text-sm">{state.currentPlayer.specialty} specialist · Rating {state.currentPlayer.rating}</div>
              ) : (
                <div className="text-chalk-dim text-sm">{state.currentPlayer.position} · Age {state.currentPlayer.age} · {state.currentPlayer.nationality} · {state.currentPlayer.star_rating}★</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-widest text-chalk-dim">{state.status === 'paused' ? 'Time left (paused)' : 'Time left'}</div>
              <div className={`font-display text-4xl ${state.status === 'paused' ? 'text-chalk-dim' : timeLeft <= 5 ? 'text-crimson' : 'text-gold'}`}>{timeLeft}s</div>
            </div>
          </div>

          {state.lotType !== 'coach' && (
            <div className="grid grid-cols-6 gap-2 text-center text-xs">
              {['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'].map((s) => (
                <div key={s} className="bg-ink-soft rounded py-2">
                  <div className="font-mono-tab text-lg text-chalk">{state.currentPlayer[s]}</div>
                  <div className="text-chalk-dim capitalize">{s}</div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-ink-soft rounded-lg px-4 py-3 space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-chalk-dim">Current bid</div>
              <div className="font-display text-3xl text-turf">${Number(state.currentBid).toLocaleString()}</div>
            </div>

            {user?.teamId && state.status === 'active' && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {[500_000, 1_000_000, 5_000_000, 10_000_000].map((inc) => (
                    <button key={inc} onClick={() => quickBid(inc)}
                      className="px-3 py-2 rounded-md bg-surface border border-turf text-turf font-semibold text-sm hover:bg-turf hover:text-ink">
                      +{inc >= 1_000_000 ? `${inc / 1_000_000}M` : `${inc / 1000}K`}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} placeholder="Custom bid amount"
                    className="flex-1 bg-surface border border-line rounded px-2 py-2 text-sm font-mono-tab" />
                  <button onClick={bid} className="px-4 py-2 rounded-md bg-gold text-ink font-semibold text-sm hover:brightness-110">Bid</button>
                </div>
              </div>
            )}
            {user?.teamId && state.status === 'paused' && (
              <div className="text-sm text-chalk-dim italic">Bidding is paused</div>
            )}
          </div>

          <div className="space-y-1 max-h-40 overflow-y-auto">
            {[...state.recentLog].reverse().map((l, i) => (
              <div key={i} className="text-xs text-chalk-dim font-mono-tab">
                {l.type === 'bid' && `Bid: $${Number(l.amount).toLocaleString()} on ${l.playerName}`}
                {l.type === 'sold' && `SOLD: ${l.playerName} for $${Number(l.amount).toLocaleString()}`}
                {l.type === 'unsold' && `Unsold: ${l.playerName}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
