import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const CARD_LABEL = { hero: 'Hero', legend: 'Icon', special: 'Special' };

export default function TeamPage() {
  const { id } = useParams();
  const { user, refresh } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('squad');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api.get(`/teams/${id}`).then(setData).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="text-chalk-dim">Loading…</div>;
  const { team, players, coach, manager, marqueeRequests, allowedCardTypes, formations, mentalities } = data;
  const isManager = user && (user.role === 'admin' || (user.role === 'manager' && user.teamId === team.id));

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3500); };

  const claim = async () => {
    try { await api.post(`/teams/${id}/claim`); await refresh(); load(); }
    catch (e) { flash(e.message); }
  };

  const overall = (p) => p.position === 'GK' ? p.goalkeeping : Math.round((p.pace + p.shooting + p.passing + p.dribbling + p.defending + p.physical) / 6);
  const sorted = [...players].sort((a, b) => overall(b) - overall(a));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-chalk-dim">{team.stage_name} · Stage {team.tier_order}</div>
          <h1 className="font-display text-4xl text-chalk tracking-wide flex items-center gap-3">
            <span className="w-5 h-5 rounded-full" style={{ background: team.color }} />
            {team.name.toUpperCase()}
          </h1>
          <div className="text-chalk-dim text-sm mt-1">{team.stadium_name} · Manager: {manager || 'Unclaimed'}</div>
        </div>
        {!manager && user && (
          <button onClick={claim} className="px-4 py-2 rounded-md bg-turf text-ink font-semibold text-sm hover:bg-turf-dim">Claim this club</button>
        )}
      </div>

      {msg && <div className="bg-surface border border-gold/40 text-gold text-sm rounded-md px-3 py-2">{msg}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Budget" value={`$${Number(team.budget).toLocaleString()}`} />
        <MiniStat label="Record" value={`${team.wins}W ${team.draws}D ${team.losses}L`} />
        <MiniStat label="Points" value={team.points} />
        <MiniStat label="Squad" value={players.length} />
      </div>

      <div className="flex gap-1 bg-surface border border-line rounded-md p-1 w-fit flex-wrap">
        {['squad', 'tactics', 'club', 'marquee'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded text-sm font-medium capitalize ${tab === t ? 'bg-turf text-ink' : 'text-chalk-dim'}`}>{t}</button>
        ))}
      </div>

      {tab === 'squad' && (
        <div className="border border-line rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-chalk-dim text-xs uppercase tracking-wide border-b border-line bg-surface">
                <th className="text-left px-3 py-2">Player</th>
                <th className="text-left px-3 py-2">Pos</th>
                <th className="text-right px-3 py-2 font-mono-tab">Age</th>
                <th className="text-right px-3 py-2 font-mono-tab">OVR</th>
                <th className="text-right px-3 py-2 font-mono-tab">Star</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className="border-b border-line/50 last:border-0 hover:bg-surface-raised/60">
                  <td className="px-3 py-2">
                    <Link to={`/players/${p.id}`} className="hover:text-turf font-medium">{p.name}</Link>
                    {p.card_type && <span className="ml-2 text-[9px] uppercase font-bold text-gold bg-gold/15 px-1.5 py-0.5 rounded">{CARD_LABEL[p.card_type]}</span>}
                  </td>
                  <td className="px-3 py-2 text-chalk-dim">{p.position}</td>
                  <td className="px-3 py-2 text-right font-mono-tab">{p.age}</td>
                  <td className="px-3 py-2 text-right font-mono-tab font-bold">{overall(p)}</td>
                  <td className="px-3 py-2 text-right font-mono-tab text-gold">{p.star_rating ?? '—'}</td>
                  <td className="px-3 py-2">
                    {p.injury_status === 'Injured' ? <span className="text-crimson text-xs">Injured ({p.injury_matches_remaining})</span> :
                      p.wants_to_leave ? <span className="text-gold text-xs">Unsettled</span> :
                      <span className="text-turf text-xs">Fit</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'tactics' && (
        <TacticsTab team={team} players={players} formations={formations} mentalities={mentalities} isManager={isManager} onSaved={() => flash('Tactics saved.')} teamId={id} reload={load} />
      )}

      {tab === 'club' && (
        <ClubTab team={team} coach={coach} isManager={isManager} teamId={id} reload={load} flash={flash} />
      )}

      {tab === 'marquee' && (
        <MarqueeTab team={team} players={players} allowedCardTypes={allowedCardTypes} marqueeRequests={marqueeRequests} isManager={isManager} teamId={id} reload={load} flash={flash} />
      )}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="bg-surface border border-line rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-chalk-dim">{label}</div>
      <div className="font-mono-tab text-lg text-chalk">{value}</div>
    </div>
  );
}

function TacticsTab({ team, players, formations, mentalities, isManager, onSaved, teamId, reload }) {
  const [formation, setFormation] = useState(team.formation);
  const [mentality, setMentality] = useState(team.mentality);
  const save = async () => {
    await api.post(`/teams/${teamId}/tactics`, { formation, mentality });
    onSaved();
    reload();
  };
  return (
    <div className="bg-surface border border-line rounded-lg p-5 max-w-md space-y-4">
      <div>
        <label className="block text-xs uppercase tracking-wide text-chalk-dim mb-1">Formation</label>
        <select disabled={!isManager} value={formation} onChange={(e) => setFormation(e.target.value)}
          className="w-full bg-ink-soft border border-line rounded-md px-3 py-2 text-sm disabled:opacity-60">
          {formations.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wide text-chalk-dim mb-1">Mentality</label>
        <select disabled={!isManager} value={mentality} onChange={(e) => setMentality(e.target.value)}
          className="w-full bg-ink-soft border border-line rounded-md px-3 py-2 text-sm disabled:opacity-60">
          {mentalities.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {isManager && <button onClick={save} className="px-4 py-2 rounded-md bg-turf text-ink font-semibold text-sm hover:bg-turf-dim">Save default tactics</button>}
      <p className="text-xs text-chalk-dim">This sets the default XI/formation used when a match kicks off. You can still change formation, mentality, and make substitutions live during any match.</p>
    </div>
  );
}

function ClubTab({ team, coach, isManager, teamId, reload, flash }) {
  const [coaches, setCoaches] = useState([]);
  const [sponsorOffers, setSponsorOffers] = useState([]);
  useEffect(() => {
    if (isManager) {
      api.get('/news/coaches').then((d) => setCoaches(d.coaches.filter((c) => !c.team_id))).catch(() => {});
    }
  }, [isManager]);

  const upgrade = async (facility) => {
    try { const r = await api.post(`/teams/${teamId}/facilities`, { facility }); flash(`Upgraded to level ${r.level} for $${r.spent.toLocaleString()}.`); reload(); }
    catch (e) { flash(e.message); }
  };
  const hire = async (coachId) => {
    try { await api.post(`/teams/${teamId}/coach/${coachId}`); flash('Coach hired.'); reload(); }
    catch (e) { flash(e.message); }
  };
  const fire = async () => {
    try { await api.del(`/teams/${teamId}/coach`); flash('Coach released.'); reload(); }
    catch (e) { flash(e.message); }
  };
  const loadSponsors = async () => {
    try { const r = await api.get(`/teams/${teamId}/sponsor-offers`); setSponsorOffers(r.offers); }
    catch (e) { flash(e.message); }
  };
  const respondSponsor = async (offerId, decision) => {
    try { await api.post(`/market/sponsor-offers/${offerId}/respond`, { decision }); flash('Sponsor decision recorded.'); setSponsorOffers([]); reload(); }
    catch (e) { flash(e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className="bg-surface border border-line rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">Facilities</h3>
        <FacilityRow label="Youth Academy" level={team.youth_level} note="Raises youth-intake quantity (1-5/yr) and quality, and speeds player development." onUpgrade={() => upgrade('youth_level')} disabled={!isManager} />
        {team.youth_coach_name && <div className="text-xs text-chalk-dim -mt-2">Youth Coach: {team.youth_coach_name}</div>}
        <FacilityRow label="Medical Centre" level={team.medical_level} note="Cuts injury recovery time — up to 50% faster at level 5." onUpgrade={() => upgrade('medical_level')} disabled={!isManager} />
        {team.medical_staff_name && <div className="text-xs text-chalk-dim -mt-2">Head Physio: {team.medical_staff_name}</div>}
      </div>

      <div className="bg-surface border border-line rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">Coach</h3>
        {coach ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">{coach.name}</div>
              <div className="text-xs text-chalk-dim">{coach.specialty} · Rating {coach.rating}</div>
            </div>
            {isManager && <button onClick={fire} className="text-xs text-crimson hover:underline">Release</button>}
          </div>
        ) : <div className="text-chalk-dim text-sm">No coach under contract.</div>}
        {isManager && !coach && (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {coaches.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm bg-ink-soft rounded px-2 py-1.5">
                <span>{c.name} <span className="text-chalk-dim">({c.specialty}, {c.rating})</span></span>
                <button onClick={() => hire(c.id)} className="text-turf text-xs hover:underline">Hire</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {isManager && (
        <div className="bg-surface border border-line rounded-lg p-5 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">Sponsorship</h3>
            <button onClick={loadSponsors} className="text-xs text-turf hover:underline">Check offers</button>
          </div>
          {team.sponsor_name && (
            <div className="text-sm text-chalk">Current: <span className="font-medium">{team.sponsor_name}</span> · ${Number(team.sponsor_value).toLocaleString()}/season · {team.sponsor_seasons_left} season(s) left</div>
          )}
          {sponsorOffers.map((o) => (
            <div key={o.id} className="flex items-center justify-between bg-ink-soft rounded px-3 py-2">
              <span className="text-sm">{o.sponsor_name} — ${Number(o.value).toLocaleString()}/yr × {o.length_seasons}yr</span>
              <div className="flex gap-2">
                <button onClick={() => respondSponsor(o.id, 'accept')} className="text-xs px-2 py-1 rounded bg-turf/20 text-turf hover:bg-turf/30">Accept</button>
                <button onClick={() => respondSponsor(o.id, 'reject')} className="text-xs px-2 py-1 rounded bg-crimson/20 text-crimson hover:bg-crimson/30">Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FacilityRow({ label, level, note, onUpgrade, disabled }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm">{label}</span>
        <span className="font-mono-tab text-gold">{'★'.repeat(level)}{'☆'.repeat(5 - level)}</span>
      </div>
      <p className="text-[11px] text-chalk-dim mb-1.5">{note}</p>
      {!disabled && level < 5 && <button onClick={onUpgrade} className="text-xs text-turf hover:underline">Upgrade to level {level + 1}</button>}
    </div>
  );
}

function MarqueeTab({ team, players, allowedCardTypes, marqueeRequests, isManager, teamId, reload, flash }) {
  const held = players.filter((p) => p.card_type);
  const request = async (cardType) => {
    try { await api.post(`/teams/${teamId}/marquee-request`, { cardType }); flash('Request sent to the admin.'); reload(); }
    catch (e) { flash(e.message); }
  };
  return (
    <div className="bg-surface border border-line rounded-lg p-5 space-y-4 max-w-xl">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">Icon / Hero / Special slots</h3>
      {['legend', 'hero', 'special'].map((type) => {
        const allowed = allowedCardTypes.includes(type);
        const owned = held.find((p) => p.card_type === type);
        const pending = marqueeRequests.find((r) => r.card_type === type);
        return (
          <div key={type} className="flex items-center justify-between bg-ink-soft rounded px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">{{ legend: 'Icon', hero: 'Hero', special: 'Special' }[type]}</div>
              <div className="text-xs text-chalk-dim">{!allowed ? 'Not available at this division' : owned ? owned.name : pending ? 'Request pending' : 'Slot open'}</div>
            </div>
            {isManager && allowed && !owned && !pending && (
              <button onClick={() => request(type)} className="text-xs text-turf hover:underline">Request</button>
            )}
          </div>
        );
      })}
      <p className="text-xs text-chalk-dim">Icons/Heroes/Specials are hand-built by the admin and can never be transferred — this just puts in the request.</p>
    </div>
  );
}
