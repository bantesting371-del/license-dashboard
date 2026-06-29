import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, api } from '../context/AuthContext';

// SVG icon components — no emojis, no box-drawing chars, pure vector
function IconShoppingBag() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 01-8 0"/>
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78l7.61-7.61z"/>
    </svg>
  );
}

function IconCreditCard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  );
}

function IconTrophy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="14 14 14 8 10 8 10 14"/>
      <path d="M17 8h2a2 2 0 012 2v1a4 4 0 01-4 4"/>
      <path d="M7 8H5a2 2 0 00-2 2v1a4 4 0 004 4"/>
      <rect x="8" y="17" width="8" height="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
    </svg>
  );
}

// Rank indicators — SVG-based, no emoji medals
const RANK_COLORS = ['#f59e0b', '#94a3b8', '#b45309'];
const RANK_LABELS = ['1st', '2nd', '3rd'];

function RankBadge({ index }) {
  return (
    <span
      className="rank-badge"
      style={{ background: `${RANK_COLORS[index]}1a`, color: RANK_COLORS[index], border: `1px solid ${RANK_COLORS[index]}44` }}
      aria-label={`Rank ${index + 1}`}
    >
      {RANK_LABELS[index]}
    </span>
  );
}

// Quick action card
function QuickLink({ to, icon: Icon, label, sub, color }) {
  return (
    <Link to={to} className="quick-link" style={{ '--ql-color': color }}>
      <span className="ql-icon-wrap" style={{ background: `${color}18`, color }}>
        <Icon />
      </span>
      <span className="ql-body">
        <span className="ql-label">{label}</span>
        <span className="ql-sub">{sub}</span>
      </span>
      <span className="ql-arrow">
        <IconChevronRight />
      </span>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [topResellers,  setTopResellers]  = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [topRes, notRes] = await Promise.all([
        api.get('/api/stats/top-resellers'),
        api.get('/api/notifications'),
      ]);
      setTopResellers(topRes.data);
      setNotifications(notRes.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="loading-screen" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</span>
      </div>
    );
  }

  const credits   = user?.credits ?? 0;
  const totalRech = user?.total_recharged ?? 0;
  const unread    = notifications.filter(n => {
    try { return !JSON.parse(n.read_by || '[]').includes(user?.username); }
    catch { return true; }
  }).length;

  return (
    <div className="dash-root">

      {/* Greeting + Balance */}
      <div className="dash-hero">
        <div className="dash-greeting">
          <h1 className="dash-welcome">
            Welcome back, <span className="dash-username">{user?.username}</span>
          </h1>
          <p className="dash-tagline">Devish Store — your license dashboard</p>
        </div>

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

      {/* Quick actions */}
      <section className="quick-section" aria-label="Quick actions">
        <QuickLink
          to="/products"
          icon={IconShoppingBag}
          label="Buy a License"
          sub="Browse all products"
          color="var(--brand)"
        />
        <QuickLink
          to="/licenses"
          icon={IconKey}
          label="My Licenses"
          sub="View and manage keys"
          color="var(--success)"
        />
        <QuickLink
          to="/payments"
          icon={IconCreditCard}
          label="Add Deposit"
          sub="Top up via USDT"
          color="var(--warning)"
        />
      </section>

      {/* Bottom row */}
      <div className="dash-bottom">

        {/* Top Resellers */}
        <div className="card dash-card">
          <div className="dash-card-header">
            <span className="dash-card-icon"><IconTrophy /></span>
            <h2 className="dash-card-title">Top Resellers</h2>
          </div>

          {topResellers.length === 0 ? (
            <div className="dash-empty">
              <div className="dash-empty-bar" />
              <div className="dash-empty-bar short" />
              <div className="dash-empty-bar shorter" />
              <p>No reseller data yet</p>
            </div>
          ) : (
            <ol className="reseller-list" aria-label="Top 3 resellers">
              {topResellers.slice(0, 3).map((r, i) => (
                <li key={r.username} className="reseller-row">
                  <RankBadge index={i} />
                  <span className="reseller-name">{r.username}</span>
                  <span className="reseller-amount">${r.total_recharged.toFixed(2)}</span>
                  <div
                    className="reseller-bar"
                    style={{
                      '--bar-w': `${Math.min(100, (r.total_recharged / (topResellers[0]?.total_recharged || 1)) * 100)}%`,
                      '--bar-color': RANK_COLORS[i],
                    }}
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Notifications */}
        <div className="card dash-card">
          <div className="dash-card-header">
            <span className="dash-card-icon"><IconBell /></span>
            <h2 className="dash-card-title">Notifications</h2>
            {unread > 0 && (
              <span className="dash-unread-badge" aria-label={`${unread} unread`}>{unread}</span>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="dash-notif-empty">
              <div className="notif-empty-icon" aria-hidden="true">
                <IconBell />
              </div>
              <p>No notifications yet</p>
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
