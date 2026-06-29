import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, api } from '../context/AuthContext';

// ─── Dashboard ───────────────────────────────────────────────────────────────
// Ultra-minimal homepage: balance, top-3 resellers, latest notifications.
// No license table here — keeps the screen clean & professional.
// Quick-action pills give instant access to the 3 most common tasks.
// ─────────────────────────────────────────────────────────────────────────────

const MEDALS  = ['🥇', '🥈', '🥉'];
const MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#b45309'];

function QuickLink({ to, icon, label, sub, color }) {
  return (
    <Link to={to} className="quick-link" style={{ '--ql-color': color }}>
      <span className="ql-icon" aria-hidden="true">{icon}</span>
      <span className="ql-body">
        <span className="ql-label">{label}</span>
        <span className="ql-sub">{sub}</span>
      </span>
      <span className="ql-arrow" aria-hidden="true">→</span>
    </Link>
  );
}

export default function Dashboard() {
  const { user }            = useAuth();
  const [topResellers,  setTopResellers]  = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [topRes, notRes] = await Promise.all([
        api.get('/api/stats/top-resellers'),
        api.get('/api/notifications'),
      ]);
      setTopResellers(topRes.data);
      setNotifications(notRes.data);
    } catch { /* silent — individual sections show their own empty states */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="loading-screen" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</span>
      </div>
    );
  }

  const credits     = user?.credits ?? 0;
  const totalRech   = user?.total_recharged ?? 0;
  const unreadCount = notifications.filter(n => {
    try { return !JSON.parse(n.read_by || '[]').includes(user?.username); }
    catch { return true; }
  }).length;

  return (
    <div className="dash-root">

      {/* ── greeting & balance ── */}
      <div className="dash-hero">
        <div className="dash-greeting">
          <h1 className="dash-welcome">
            Hey, <span className="dash-username">{user?.username}</span> 👋
          </h1>
          <p className="dash-tagline">Welcome to Devish Store</p>
        </div>

        {/* balance card */}
        <div className="balance-card">
          <div className="balance-label">Available Balance</div>
          <div className="balance-amount">${credits.toFixed(2)}</div>
          <div className="balance-meta">
            Total recharged: <strong>${totalRech.toFixed(2)}</strong>
          </div>
          <Link to="/payments" className="btn btn-primary btn-sm" style={{ marginTop: 14, alignSelf: 'flex-start' }}>
            + Add Credits
          </Link>
        </div>
      </div>

      {/* ── quick actions ── */}
      <section className="quick-section" aria-label="Quick actions">
        <QuickLink
          to="/products"
          icon="📦"
          label="Buy a License"
          sub="Browse all products"
          color="var(--brand)"
        />
        <QuickLink
          to="/licenses"
          icon="🔑"
          label="My Licenses"
          sub="View & manage keys"
          color="var(--success)"
        />
        <QuickLink
          to="/payments"
          icon="💳"
          label="Add Deposit"
          sub="Top up via USDT"
          color="var(--warning)"
        />
      </section>

      {/* ── bottom row: resellers + notifications ── */}
      <div className="dash-bottom">

        {/* top 3 resellers */}
        <div className="card dash-card" aria-label="Top resellers">
          <h2 className="card-section-title">🏆 Top Resellers</h2>

          {topResellers.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px 0' }}>
              <div className="empty-state-icon" style={{ fontSize: 28 }}>🏅</div>
              <p>No reseller data yet</p>
            </div>
          ) : (
            <ol className="reseller-list" aria-label="Top 3 resellers">
              {topResellers.slice(0, 3).map((r, i) => (
                <li key={r.username} className="reseller-row">
                  <span className="reseller-medal" style={{ color: MEDAL_COLORS[i] }}>
                    {MEDALS[i]}
                  </span>
                  <span className="reseller-name">{r.username}</span>
                  <span
                    className="badge badge-success"
                    style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}
                  >
                    ${r.total_recharged.toFixed(2)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* notifications */}
        <div className="card dash-card" aria-label="Notifications">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 className="card-section-title" style={{ margin: 0 }}>
              🔔 Notifications
            </h2>
            {unreadCount > 0 && (
              <span className="badge badge-danger">{unreadCount} new</span>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px 0' }}>
              <div className="empty-state-icon" style={{ fontSize: 28 }}>📭</div>
              <p>No notifications</p>
            </div>
          ) : (
            <ul className="notif-list" aria-label="Recent notifications">
              {notifications.slice(0, 4).map(n => {
                let isRead = false;
                try { isRead = JSON.parse(n.read_by || '[]').includes(user?.username); }
                catch { isRead = false; }
                return (
                  <li key={n.id} className={`notif-item ${isRead ? 'notif-read' : ''}`}>
                    {!isRead && <span className="notif-dot" aria-label="Unread" />}
                    <div className="notif-body">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-msg">{n.message}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}
