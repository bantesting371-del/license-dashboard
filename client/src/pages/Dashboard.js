import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, api } from '../context/AuthContext';

function StatCard({ icon, label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: `${color}18`, fontSize: 18 }}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [licenses, setLicenses] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [topResellers, setTopResellers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [licRes, notRes, topRes] = await Promise.all([
        api.get('/api/licenses/my'),
        api.get('/api/notifications'),
        api.get('/api/stats/top-resellers'),
      ]);
      setLicenses(licRes.data);
      setNotifications(notRes.data);
      setTopResellers(topRes.data);
    } catch { /* handled gracefully */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const now = new Date();
  const activeCount = licenses.filter(l => new Date(l.expiry_date) > now).length;
  const expiredCount = licenses.length - activeCount;

  const medals = ['🥇', '🥈', '🥉'];

  if (loading) {
    return (
      <div className="loading-screen" role="status">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Welcome back, {user?.username} 👋</h1>

      {/* Stats */}
      <div className="grid-stats" style={{ marginBottom: 24 }}>
        <StatCard icon="📋" label="Total Licenses" value={licenses.length} color="var(--brand-light)" />
        <StatCard icon="✅" label="Active" value={activeCount} color="var(--success)" />
        <StatCard icon="⏰" label="Expired" value={expiredCount} color="var(--danger)" />
        <StatCard icon="💰" label="Balance" value={`$${user?.credits?.toFixed(2) ?? '0.00'}`} color="var(--warning)" />
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 20 }}>
        {/* Recent licenses */}
        <div className="card" style={{ flex: '2 1 440px', margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Recent Licenses</h2>
            <Link to="/products" className="btn btn-primary btn-sm">+ Buy</Link>
          </div>
          {licenses.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔑</div>
              <p>No licenses yet.</p>
              <Link to="/products" className="btn btn-primary" style={{ marginTop: 14, display: 'inline-flex' }}>Browse Products</Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Key</th>
                    <th>Expiry</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {licenses.slice(0, 5).map(l => {
                    const active = new Date(l.expiry_date) > now;
                    return (
                      <tr key={l.id}>
                        <td><strong>{l.product_name}</strong></td>
                        <td><code>{l.key}</code></td>
                        <td style={{ fontSize: 12.5 }}>{new Date(l.expiry_date).toLocaleDateString()}</td>
                        <td>
                          <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
                            {active ? 'Active' : 'Expired'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {licenses.length > 5 && (
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <Link to="/licenses" className="btn btn-ghost btn-sm">View all {licenses.length}</Link>
            </div>
          )}
        </div>

        {/* Top resellers */}
        <div className="card" style={{ flex: '1 1 240px', margin: 0 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 18 }}>🏆 Top Resellers</h2>
          {topResellers.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px 0' }}>
              <p>No data yet</p>
            </div>
          ) : (
            topResellers.map((r, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 0', borderBottom: i < topResellers.length - 1 ? '1px solid var(--border-subtle)' : 'none'
              }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {medals[i] || `#${i + 1}`} {r.username}
                </span>
                <span className="badge badge-success">${r.total_recharged.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="card" style={{ margin: 0 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 16 }}>🔔 Notifications</h2>
          {notifications.slice(0, 5).map((n, i) => (
            <div key={n.id} className="notif-card">
              <span className="notif-dot" aria-hidden="true" />
              <div>
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                <p style={{ fontSize: 13, marginTop: 3 }}>{n.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
