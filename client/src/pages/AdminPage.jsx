import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AdminPage() {
  const [tab, setTab] = useState('lifecycle');
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 5000); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl text-chalk tracking-wide">ADMIN PANEL</h1>
        <p className="text-chalk-dim text-sm">Full control over the league's lifecycle, users, and marquee players.</p>
      </div>
      {msg && <div className="bg-surface border border-gold/40 text-gold text-sm rounded-md px-3 py-2 whitespace-pre-wrap">{msg}</div>}
      <div className="flex gap-1 bg-surface border border-line rounded-md p-1 w-fit flex-wrap">
        {['lifecycle', 'users', 'marquee', 'players'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded text-sm font-medium capitalize ${tab === t ? 'bg-turf text-ink' : 'text-chalk-dim'}`}>{t}</button>
        ))}
      </div>
      {tab === 'lifecycle' && <LifecycleTab flash={flash} />}
      {tab === 'users' && <UsersTab flash={flash} />}
      {tab === 'marquee' && <MarqueeAdminTab flash={flash} />}
      {tab === 'players' && <PlayerEditTab flash={flash} />}
    </div>
  );
}

function DangerButton({ label, onClick, tone = 'gold', confirmText }) {
  const [confirming, setConfirming] = useState(false);
  const styles = tone === 'crimson'
    ? { text: 'text-crimson', chip: 'bg-crimson/25 text-crimson', outline: 'border-crimson/40 text-crimson hover:bg-crimson/10' }
    : { text: 'text-gold', chip: 'bg-gold/25 text-gold', outline: 'border-gold/40 text-gold hover:bg-gold/10' };
  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className={`text-xs ${styles.text}`}>{confirmText || 'Are you sure?'}</span>
        <button onClick={() => { setConfirming(false); onClick(); }} className={`text-xs px-2 py-1 rounded ${styles.chip}`}>Confirm</button>
        <button onClick={() => setConfirming(false)} className="text-xs px-2 py-1 rounded bg-surface-raised text-chalk-dim">Cancel</button>
      </div>
    );
  }
  return <button onClick={() => setConfirming(true)} className={`px-3 py-1.5 rounded-md border text-sm ${styles.outline}`}>{label}</button>;
}

function LifecycleTab({ flash }) {
  const [stages, setStages] = useState([]);
  useEffect(() => { api.get('/stages').then((d) => setStages(d.stages)).catch(() => {}); }, []);

  const call = async (fn, successMsg) => {
    try { const r = await fn(); flash(successMsg(r)); }
    catch (e) { flash('Error: ' + e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className="bg-surface border border-line rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">Season lifecycle</h3>
        <Row label="Run mid-season development" note="Nudges every player's sub-attributes (≈twice a season / every 6 months).">
          <button onClick={() => call(() => api.post('/admin/development/run'), (r) => `Development run: ${r.playersProcessed} players processed.`)} className="text-xs px-3 py-1.5 rounded bg-turf/20 text-turf">Run</button>
        </Row>
        <Row label="Advance to next season" note="Finalizes standings, pays prize money, settles wages/sponsors, promotes/relegates top-2/bottom-2, runs development, retirements, youth intake, and regenerates fixtures.">
          <DangerButton label="Advance season" onClick={() => call(() => api.post('/admin/season/advance', {}), (r) => `Season advanced to ${r.season}. ${r.retirees} retired, ${r.youthGraduates} youth graduates.`)} confirmText="This rolls over the whole league." />
        </Row>
      </div>

      <div className="bg-surface border border-line rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">Fixtures</h3>
        {stages.map((s) => (
          <Row key={s.id} label={s.name} note={`Stage ${s.tier_order}`}>
            <button onClick={() => call(() => api.post(`/admin/fixtures/${s.id}/generate`, { homeAndAway: false }), (r) => `${r.count} fixtures generated for ${s.name}.`)} className="text-xs px-3 py-1.5 rounded bg-turf/20 text-turf">Generate</button>
          </Row>
        ))}
      </div>

      <div className="bg-surface border border-crimson/30 rounded-lg p-5 space-y-3 md:col-span-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-crimson">Danger zone</h3>
        <Row label="Reset current season" note="Clears this season's results and regenerates fixtures. Squads, contracts, and finances are untouched.">
          <DangerButton tone="crimson" label="Reset season" onClick={() => call(() => api.post('/admin/reset/season', {}), () => 'Season reset.')} confirmText="Clear all results this season?" />
        </Row>
        <Row label="Full league reset" note="Wipes everything and regenerates a brand new world: 24 real clubs (top-5 European leagues), a fresh 800+ real-player free-agent pool, and a pool of 72 real managers — all auctioned off tier-by-tier. User accounts are kept but every manager claim is cleared.">
          <DangerButton tone="crimson" label="Full reset" onClick={() => call(() => api.post('/admin/reset/full', {}), (r) => `World reset: ${r.teams} teams, ${r.players} players, ${r.coaches} coaches.`)} confirmText="This wipes the entire league. Type nothing, just confirm." />
        </Row>
      </div>
    </div>
  );
}

function Row({ label, note, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div>
        <div className="text-sm text-chalk">{label}</div>
        <div className="text-[11px] text-chalk-dim">{note}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function UsersTab({ flash }) {
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [newCreds, setNewCreds] = useState(null); // { created: [...] } or { username, password } from a single reset
  const [audit, setAudit] = useState(null);
  const load = () => {
    api.get('/admin/users').then((d) => setUsers(d.users)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
  };
  useEffect(load, []);

  const setRole = async (id, role, teamId) => {
    try { await api.post(`/admin/users/${id}/role`, { role, teamId }); flash('Updated.'); load(); }
    catch (e) { flash(e.message); }
  };

  const provisionAll = async () => {
    try {
      const d = await api.post('/admin/users/provision-managers', {});
      setNewCreds(d.created);
      flash(d.created.length ? `Created ${d.created.length} club login(s).` : 'Every club already has a manager login.');
      load();
    } catch (e) { flash(e.message); }
  };

  const resetOne = async (id) => {
    try {
      const d = await api.post(`/admin/users/${id}/reset-password`, {});
      setNewCreds([{ teamName: users.find((u) => u.id === id)?.team_name, username: d.username, password: d.password }]);
      flash('Password reset.');
    } catch (e) { flash(e.message); }
  };

  const loadAudit = async () => {
    if (audit) { setAudit(null); return; }
    try { const d = await api.get('/admin/audit-log?limit=50'); setAudit(d.entries); }
    catch (e) { flash(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={provisionAll} className="text-xs px-3 py-1.5 rounded bg-turf text-ink font-semibold">Provision club logins for every unmanned club</button>
        <button onClick={loadAudit} className="text-xs px-3 py-1.5 rounded bg-surface-raised border border-line text-chalk-dim hover:text-gold hover:border-gold">{audit ? 'Hide' : 'Show'} audit log</button>
      </div>

      {newCreds && (
        <div className="border border-gold/40 rounded-lg p-3 bg-gold/5 space-y-1">
          <div className="text-xs uppercase tracking-widest text-gold flex items-center justify-between">
            <span>New credentials — shown once, copy them now</span>
            <button onClick={() => setNewCreds(null)} className="text-chalk-dim hover:text-chalk">✕</button>
          </div>
          {newCreds.map((c, i) => (
            <div key={i} className="text-sm font-mono-tab">{c.teamName || '—'}: <b>{c.username}</b> / <b>{c.password}</b></div>
          ))}
        </div>
      )}

      {audit && (
        <div className="border border-line rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-chalk-dim uppercase tracking-wide border-b border-line bg-surface">
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Actor</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Target</th>
                <th className="text-left px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-2 text-chalk-dim whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{a.actor_name || '—'}</td>
                  <td className="px-3 py-2">{a.action}</td>
                  <td className="px-3 py-2 text-chalk-dim">{a.target_type} #{a.target_id}</td>
                  <td className="px-3 py-2 text-chalk-dim">{a.details ? JSON.stringify(a.details) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border border-line rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-chalk-dim text-xs uppercase tracking-wide border-b border-line bg-surface">
              <th className="text-left px-3 py-2">Username</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-left px-3 py-2">Change</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line/50 last:border-0">
                <td className="px-3 py-2">{u.username}</td>
                <td className="px-3 py-2 capitalize">{u.role}</td>
                <td className="px-3 py-2 text-chalk-dim">{u.team_name || '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1.5 items-center">
                    <button onClick={() => setRole(u.id, 'admin', null)} className="text-xs px-2 py-1 rounded bg-gold/15 text-gold">Admin</button>
                    <button onClick={() => setRole(u.id, 'viewer', null)} className="text-xs px-2 py-1 rounded bg-surface-raised text-chalk-dim">Viewer</button>
                    <select onChange={(e) => e.target.value && setRole(u.id, 'manager', Number(e.target.value))} defaultValue="" className="text-xs bg-ink-soft border border-line rounded px-1">
                      <option value="" disabled>Manager of…</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button onClick={() => resetOne(u.id)} className="text-xs px-2 py-1 rounded bg-surface-raised border border-line text-chalk-dim hover:text-gold hover:border-gold">Reset password</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarqueeAdminTab({ flash }) {
  const [requests, setRequests] = useState([]);
  const [teams, setTeams] = useState([]);
  const [summary, setSummary] = useState({ counts: [], caps: {} });
  const [form, setForm] = useState({ teamId: '', cardType: 'special', name: '', position: 'ST', age: 27, nationality: '', wage: 100000,
    pace: 80, shooting: 80, passing: 80, dribbling: 80, defending: 80, physical: 80, goalkeeping: 10 });

  const load = () => {
    api.get('/admin/marquee-requests').then((d) => setRequests(d.requests)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
    api.get('/admin/marquee-summary').then(setSummary).catch(() => {});
  };
  useEffect(load, []);

  const fulfill = async (req) => {
    setForm((f) => ({ ...f, teamId: req.team_id, cardType: req.card_type, requestId: req.id }));
  };

  const create = async () => {
    try {
      await api.post('/admin/marquee-players', {
        teamId: Number(form.teamId), cardType: form.cardType, requestId: form.requestId,
        name: form.name, position: form.position, age: Number(form.age), nationality: form.nationality,
        wage: Number(form.wage),
        stats: { pace: Number(form.pace), shooting: Number(form.shooting), passing: Number(form.passing), dribbling: Number(form.dribbling), defending: Number(form.defending), physical: Number(form.physical), goalkeeping: Number(form.goalkeeping) },
      });
      flash(`${form.name} created!`);
      setForm({ ...form, name: '', requestId: undefined });
      load();
    } catch (e) { flash(e.message); }
  };

  const capCount = (type) => summary.counts.find((c) => c.card_type === type)?.n || 0;

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className="bg-surface border border-line rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">League totals</h3>
        {['legend', 'hero', 'special'].map((t) => (
          <div key={t} className="flex justify-between text-sm"><span className="capitalize">{t === 'legend' ? 'Icon' : t}</span><span className="font-mono-tab">{capCount(t)} / {summary.caps[t]}</span></div>
        ))}
        <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim pt-3">Pending requests</h3>
        {requests.length === 0 && <div className="text-chalk-dim text-sm">None.</div>}
        {requests.map((r) => (
          <div key={r.id} className="flex items-center justify-between bg-ink-soft rounded px-3 py-2 text-sm">
            <span>{r.team_name} wants a {r.card_type === 'legend' ? 'Icon' : r.card_type}</span>
            <button onClick={() => fulfill(r)} className="text-xs text-turf hover:underline">Fulfill →</button>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-lg p-5 space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">Create marquee player</h3>
        <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className="w-full bg-ink-soft border border-line rounded px-2 py-1.5 text-sm">
          <option value="">Team…</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={form.cardType} onChange={(e) => setForm({ ...form, cardType: e.target.value })} className="w-full bg-ink-soft border border-line rounded px-2 py-1.5 text-sm">
          <option value="legend">Icon (95 suggested)</option>
          <option value="hero">Hero (89-90 suggested)</option>
          <option value="special">Special (85 suggested)</option>
        </select>
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-ink-soft border border-line rounded px-2 py-1.5 text-sm" />
        <div className="grid grid-cols-3 gap-1.5">
          <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="bg-ink-soft border border-line rounded px-2 py-1.5 text-sm">
            {['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'].map((p) => <option key={p}>{p}</option>)}
          </select>
          <input type="number" placeholder="Age" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} className="bg-ink-soft border border-line rounded px-2 py-1.5 text-sm" />
          <input placeholder="Nationality" value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} className="bg-ink-soft border border-line rounded px-2 py-1.5 text-sm" />
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping'].map((s) => (
            <div key={s}>
              <label className="text-[10px] text-chalk-dim capitalize">{s}</label>
              <input type="number" value={form[s]} onChange={(e) => setForm({ ...form, [s]: e.target.value })} className="w-full bg-ink-soft border border-line rounded px-1.5 py-1 text-xs" />
            </div>
          ))}
        </div>
        <input type="number" placeholder="Wage per season" value={form.wage} onChange={(e) => setForm({ ...form, wage: e.target.value })} className="w-full bg-ink-soft border border-line rounded px-2 py-1.5 text-sm" />
        <button onClick={create} className="w-full py-2 rounded-md bg-gold text-ink font-semibold text-sm">Create player</button>
      </div>
    </div>
  );
}

function PlayerEditTab({ flash }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);

  const search = async () => {
    const d = await api.get(`/players?q=${encodeURIComponent(query)}`);
    setResults(d.players.slice(0, 20));
  };

  const save = async () => {
    try {
      await api.patch(`/admin/players/${selected.id}`, selected);
      flash('Player updated.');
    } catch (e) { flash(e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className="bg-surface border border-line rounded-lg p-5 space-y-2">
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search player name…" className="flex-1 bg-ink-soft border border-line rounded px-2 py-1.5 text-sm" />
          <button onClick={search} className="px-3 py-1.5 rounded bg-turf/20 text-turf text-sm">Search</button>
        </div>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {results.map((p) => (
            <button key={p.id} onClick={() => setSelected(p)} className="w-full text-left text-sm bg-ink-soft rounded px-2 py-1.5 hover:bg-surface-raised">
              {p.name} <span className="text-chalk-dim">({p.position}, {p.team_name || 'free agent'})</span>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div className="bg-surface border border-line rounded-lg p-5 space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-chalk-dim">Editing {selected.name}</h3>
          <div className="grid grid-cols-2 gap-2">
            {['age', 'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping', 'potential', 'form', 'fitness', 'morale', 'wage', 'contract_seasons_left'].map((field) => (
              <div key={field}>
                <label className="text-[10px] text-chalk-dim capitalize">{field.replace(/_/g, ' ')}</label>
                <input type="number" value={selected[field] ?? ''} onChange={(e) => setSelected({ ...selected, [field]: e.target.value })}
                  className="w-full bg-ink-soft border border-line rounded px-2 py-1 text-sm" />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm pt-1">
            <input type="checkbox" checked={!!selected.retired} onChange={(e) => setSelected({ ...selected, retired: e.target.checked })} /> Retired
          </label>
          <button onClick={save} className="w-full py-2 rounded-md bg-turf text-ink font-semibold text-sm">Save changes</button>
        </div>
      )}
    </div>
  );
}
