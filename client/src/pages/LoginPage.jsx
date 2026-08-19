import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <svg width="48" height="48" viewBox="0 0 100 100" className="mx-auto mb-3"><circle cx="50" cy="50" r="45" fill="#0E1512" stroke="#2FBF71" strokeWidth="6" /><circle cx="50" cy="50" r="18" fill="none" stroke="#E8B84B" strokeWidth="4" /></svg>
          <div className="font-display text-4xl text-chalk tracking-wide">FOUNDATION LEAGUE</div>
          <div className="text-chalk-dim text-sm mt-1">Three stages. Twenty-four clubs. One table that matters.</div>
        </div>

        <div className="bg-surface border border-line rounded-lg p-6">
          <div className="flex mb-5 rounded-md bg-ink-soft p-1">
            <button onClick={() => setMode('login')} className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${mode === 'login' ? 'bg-turf text-ink' : 'text-chalk-dim'}`}>Sign in</button>
            <button onClick={() => setMode('register')} className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${mode === 'register' ? 'bg-turf text-ink' : 'text-chalk-dim'}`}>Register</button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs uppercase tracking-wide text-chalk-dim mb-1">Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} required
                className="w-full bg-ink-soft border border-line rounded-md px-3 py-2 text-sm text-chalk focus:outline-none focus:border-turf" />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-chalk-dim mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4}
                className="w-full bg-ink-soft border border-line rounded-md px-3 py-2 text-sm text-chalk focus:outline-none focus:border-turf" />
            </div>
            {error && <div className="text-crimson text-sm">{error}</div>}
            <button disabled={busy} type="submit" className="w-full py-2 rounded-md bg-turf text-ink font-semibold text-sm hover:bg-turf-dim transition-colors disabled:opacity-60">
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          {mode === 'register' && (
            <p className="text-[11px] text-chalk-dim mt-3">The very first account created becomes the league admin automatically.</p>
          )}
        </div>
      </div>
    </div>
  );
}
