import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Simple length sanitiser
const sanitise = (str, max = 64) => String(str ?? '').trim().slice(0, max);

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const u = sanitise(username);
    const p = password.slice(0, 128);
    if (!u || !p) { setError('Both fields are required.'); return; }

    setLoading(true);
    setError('');
    try {
      await login(u, p);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Incorrect username or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '60px auto', padding: '0 4px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          width: 52, height: 52, background: 'linear-gradient(135deg, var(--brand), var(--brand-dark))',
          borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', margin: '0 auto 16px', color: '#fff'
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.03em' }}>Welcome back</h1>
        <p style={{ marginTop: 6, fontSize: 14 }}>Sign in to manage your licenses</p>
      </div>

      <div className="card">
        {error && (
          <div className="alert alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span aria-hidden="true" style={{ display: 'flex' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> {error}
          </div>
        )}
        <form onSubmit={handleSubmit} noValidate autoComplete="on">
          <div className="form-group">
            <label className="form-label" htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              className="input"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              maxLength={64}
              required
              aria-required="true"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={128}
              required
              aria-required="true"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? <><span className="spinner spinner-sm" aria-hidden="true" /> Signing in…</> : 'Sign In'}
          </button>
        </form>

        <div className="divider" />
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--brand-light)', fontWeight: 600 }}>Create one</Link>
        </p>
      </div>
    </div>
  );
}
