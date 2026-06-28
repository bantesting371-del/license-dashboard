import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { user } = useAuth();
  const [licenses, setLicenses] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [topResellers, setTopResellers] = useState([]);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [licRes, notRes, topRes] = await Promise.all([
        axios.get('/api/licenses/my'),
        axios.get('/api/notifications'),
        axios.get('/api/stats/top-resellers')
      ]);
      setLicenses(licRes.data);
      setNotifications(notRes.data);
      setTopResellers(topRes.data);
    } catch (error) { console.error(error); }
  };

  const activeCount = licenses.filter(l => new Date(l.expiry_date) > new Date()).length;

  return (
    <div>
      <h1 className="page-title">Welcome, {user?.username} 👋</h1>
      
      <div className="grid" style={{ marginBottom: '32px' }}>
        <div className="card" style={{ margin: 0, padding: '24px' }}>
          <h3 style={{ color: '#a1a1aa', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TOTAL LICENSES</h3>
          <p style={{ fontSize: '36px', fontWeight: '800', marginTop: '12px' }}>{licenses.length}</p>
        </div>
        <div className="card" style={{ margin: 0, padding: '24px' }}>
          <h3 style={{ color: '#a1a1aa', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ACTIVE</h3>
          <p style={{ fontSize: '36px', fontWeight: '800', marginTop: '12px', color: '#34d399' }}>{activeCount}</p>
        </div>
        <div className="card" style={{ margin: 0, padding: '24px' }}>
          <h3 style={{ color: '#a1a1aa', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>EXPIRED</h3>
          <p style={{ fontSize: '36px', fontWeight: '800', marginTop: '12px', color: '#f87171' }}>{licenses.length - activeCount}</p>
        </div>
        <div className="card" style={{ margin: 0, padding: '24px' }}>
          <h3 style={{ color: '#a1a1aa', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CREDITS</h3>
          <p style={{ fontSize: '36px', fontWeight: '800', marginTop: '12px', color: '#fbbf24' }}>${user?.credits?.toFixed(2)}</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', marginBottom: '24px' }}>
        <div className="card" style={{ flex: '1 1 600px', margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '700' }}>Recent Licenses</h2>
            <Link to="/products" className="btn btn-primary" style={{ textDecoration: 'none' }}>+ Buy New</Link>
          </div>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Product</th><th>Key</th><th>Days</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                {licenses.slice(0, 5).map(l => (
                  <tr key={l.id}>
                    <td>{l.product_name}</td>
                    <td><code>{l.key}</code></td>
                    <td>{l.days}</td>
                    <td>{new Date(l.expiry_date).toLocaleDateString()}</td>
                    <td>
                      <span className={`badge ${new Date(l.expiry_date) > new Date() ? 'badge-success' : 'badge-danger'}`}>
                        {new Date(l.expiry_date) > new Date() ? 'Active' : 'Expired'}
                      </span>
                    </td>
                  </tr>
                ))}
                {licenses.length === 0 && <tr><td colSpan="5" style={{textAlign:'center',color:'#71717a',padding:'40px'}}>No licenses yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 300px', margin: 0 }}>
          <h2 style={{ marginBottom: '20px', fontSize: '20px', fontWeight: '700' }}>🏆 Top Resellers</h2>
          {topResellers.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <span style={{ fontWeight: '600', color: i === 0 ? '#fbbf24' : i === 1 ? '#e2e8f0' : '#b45309' }}>
                #{i + 1} {r.username}
              </span>
              <span style={{ color: '#34d399', fontWeight: '600' }}>${r.total_recharged.toFixed(2)}</span>
            </div>
          ))}
          {topResellers.length === 0 && <p style={{ color: '#71717a', textAlign: 'center', padding: '40px 0' }}>No data yet</p>}
        </div>
      </div>

      {notifications.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: '20px', fontSize: '20px', fontWeight: '700' }}>🔔 Notifications</h2>
          {notifications.slice(0, 3).map((n, i) => (
            <div key={n.id} style={{ padding: '16px 0', borderBottom: i !== Math.min(2, notifications.length - 1) ? '1px solid rgba(255, 255, 255, 0.05)' : 'none' }}>
              <strong style={{color:'#60a5fa', fontSize: '16px'}}>{n.title}</strong>
              <p style={{ color: '#a1a1aa', fontSize: '14px', marginTop: '6px' }}>{n.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
