import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../context/AuthContext';

const sanitise = (str, max = 64) => String(str ?? '').trim().slice(0, max);

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Basic password strength check
  const pwStrength = (() => {
    if (!password) return null;
    if (password.length < 6) return { level: 'weak', label: 'Too short', color: 'var(--danger)' };
    if (password.length < 10) return { level: 'fair', label: 'Fair', color: 'var(--warning)' };
    return { level: 'strong', label: 'Strong', color: 'var(--success)' };
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const u = sanitise(username);
    const p = password.slice(0, 128);
    if (!u || !p) { setError('All fields are required.'); return; }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(u)) {
      setError('Username must be 3–32 characters (letters, numbers, _ or -).');
      return;
    }
    if (p.length < 6) { setError('Password must be at least 6 characters.'); return; }

    setLoading(true); setError(''); setSuccess('');
    try {
      await api.post('/api/auth/signup', { username: u, password: p });
      setSuccess('Account created! Redirecting to sign in…');
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '60px auto', padding: '0 4px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          width: 52, height: 52, background: 'linear-gradient(135deg, var(--success), #059669)',
          borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', margin: '0 auto 16px', color: '#fff'
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
        </div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.03em' }}>Create account</h1>
        <p style={{ marginTop: 6, fontSize: 14 }}>Get started with your license dashboard</p>
      </div>

      <div className="card">
        {error && <div className="alert alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span aria-hidden="true" style={{ display: 'flex' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> {error}</div>}
        {success && <div className="alert alert-success" role="status" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span aria-hidden="true" style={{ display: 'flex' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span> {success}</div>}
        <form onSubmit={handleSubmit} noValidate autoComplete="on">
          <div className="form-group">
            <label className="form-label" htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              className="input"
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              maxLength={32}
              required
              aria-required="true"
              aria-describedby="username-hint"
            />
            <p id="username-hint" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
              3–32 characters, letters/numbers/_ or -
            </p>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="Choose a strong password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              maxLength={128}
              required
              aria-required="true"
            />
            {pwStrength && (
              <p style={{ fontSize: 11.5, marginTop: 5, color: pwStrength.color, fontWeight: 600 }}>
                Password strength: {pwStrength.label}
              </p>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? <><span className="spinner spinner-sm" aria-hidden="true" /> Creating account…</> : 'Create Account'}
          </button>
        </form>

        <div className="divider" />
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--brand-light)', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
