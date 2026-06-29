import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, api } from '../context/AuthContext';

// ─── Navbar ─────────────────────────────────────────────────────────────────
// Sticky glassmorphism bar. Desktop: inline links. Mobile: full-screen drawer
// with animated hamburger. Branding locked to "Devish Store".
// ─────────────────────────────────────────────────────────────────────────────

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate    = useNavigate();
  const location    = useLocation();
  const [logoUrl, setLogoUrl] = useState('');
  const [open,    setOpen]    = useState(false);

  /* fetch logo from /api/config once */
  useEffect(() => {
    api.get('/api/config').then(r => setLogoUrl(r.data.logoUrl)).catch(() => {});
  }, []);

  /* close drawer on route change */
  useEffect(() => { setOpen(false); }, [location.pathname]);

  /* close on Escape key */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* lock body scroll while drawer open */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleLogout = useCallback(() => {
    logout();
    setOpen(false);
    navigate('/login');
  }, [logout, navigate]);

  const isActive = (path) => location.pathname === path;

  const navLinks = user ? [
    { to: '/',          label: 'Dashboard', icon: '⊞' },
    { to: '/products',  label: 'Products',  icon: '📦' },
    { to: '/licenses',  label: 'Licenses',  icon: '🔑' },
    { to: '/payments',  label: 'Payments',  icon: '💳' },
    ...(user.role === 'admin'
      ? [{ to: '/admin', label: 'Admin', icon: '⚡', admin: true }]
      : []),
  ] : [];

  return (
    <>
      {/* ── main bar ── */}
      <nav className="navbar" role="navigation" aria-label="Main navigation">

        {/* brand */}
        <Link
          to={user ? '/' : '/login'}
          className="navbar-brand"
          aria-label="Devish Store home"
        >
          {logoUrl
            ? <img src={logoUrl} alt="Devish Store logo" loading="lazy" />
            : <span className="brand-icon" aria-hidden="true">🛒</span>
          }
          <span>Devish Store</span>
        </Link>

        {/* desktop links */}
        {user && (
          <div className="nav-links" role="menubar">
            {navLinks.map(({ to, label, admin }) => (
              <Link
                key={to}
                to={to}
                role="menuitem"
                className={isActive(to) ? 'active-link' : ''}
                style={admin ? { color: '#f59e0b' } : undefined}
              >
                {label}
              </Link>
            ))}

            {/* balance chip */}
            <span
              className="nav-credits"
              aria-label={`Balance: $${user.credits?.toFixed(2)}`}
            >
              <span aria-hidden="true">💰</span>
              ${user.credits?.toFixed(2) ?? '0.00'}
            </span>

            <button
              onClick={handleLogout}
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 4 }}
            >
              Sign out
            </button>
          </div>
        )}

        {!user && (
          <div className="nav-links">
            <Link to="/login"    className="btn btn-ghost btn-sm">Sign in</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Register</Link>
          </div>
        )}

        {/* hamburger – only when logged in */}
        {user && (
          <button
            className={`nav-hamburger ${open ? 'open' : ''}`}
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
          >
            <span /><span /><span />
          </button>
        )}
      </nav>

      {/* ── mobile drawer ── */}
      {user && (
        <div
          id="mobile-nav"
          className={`nav-mobile-panel ${open ? 'open' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          {/* store name in drawer header */}
          <div style={{
            padding: '4px 16px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize: 20 }}>🛒</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
              Devish Store
            </span>
          </div>

          {navLinks.map(({ to, label, icon, admin }) => (
            <Link
              key={to}
              to={to}
              style={admin ? { color: '#f59e0b' } : undefined}
            >
              <span aria-hidden="true">{icon}</span> {label}
            </Link>
          ))}

          {/* balance in drawer */}
          <div className="mobile-credits">
            <span aria-hidden="true">💰</span>
            Balance: <strong>${user.credits?.toFixed(2) ?? '0.00'}</strong>
          </div>

          {/* logout */}
          <button className="mobile-logout" onClick={handleLogout}>
            <span aria-hidden="true">🚪</span> Sign out
          </button>
        </div>
      )}
    </>
  );
}
