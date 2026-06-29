import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, api } from '../context/AuthContext';

// ─── Navbar ─────────────────────────────────────────────────────────────────
// Sticky glassmorphism bar. Desktop: inline links. Mobile: full-screen drawer
// with animated hamburger. Branding locked to "Devish Store".
// ─────────────────────────────────────────────────────────────────────────────

const NAV_ICONS = {
  dashboard: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>,
  products: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  licenses: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>,
  payments: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  admin: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  store: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  balance: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>,
  logout: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
};

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
    { to: '/',          label: 'Dashboard', icon: NAV_ICONS.dashboard },
    { to: '/products',  label: 'Products',  icon: NAV_ICONS.products },
    { to: '/licenses',  label: 'Licenses',  icon: NAV_ICONS.licenses },
    { to: '/payments',  label: 'Payments',  icon: NAV_ICONS.payments }
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
            : <span className="brand-icon" aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{NAV_ICONS.store}</span>
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <span aria-hidden="true" style={{ display: 'flex' }}>{NAV_ICONS.balance}</span>
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
            <span style={{ display: 'flex', alignItems: 'center' }}>{NAV_ICONS.store}</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
              Devish Store
            </span>
          </div>

          {navLinks.map(({ to, label, icon, admin }) => (
            <Link
              key={to}
              to={to}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', ...(admin ? { color: '#f59e0b' } : {}) }}
            >
              <span aria-hidden="true" style={{ display: 'flex', width: '24px', justifyContent: 'center' }}>{icon}</span> {label}
            </Link>
          ))}

          {/* balance in drawer */}
          <div className="mobile-credits" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span aria-hidden="true" style={{ display: 'flex' }}>{NAV_ICONS.balance}</span>
            Balance: <strong>${user.credits?.toFixed(2) ?? '0.00'}</strong>
          </div>

          {/* logout */}
          <button className="mobile-logout" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span aria-hidden="true" style={{ display: 'flex' }}>{NAV_ICONS.logout}</span> Sign out
          </button>
        </div>
      )}
    </>
  );
}
