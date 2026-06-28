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
      <h1 style={{ marginBottom: '25px' }}>Welcome, {user?.username} 👋</h1>
      
      <div className="grid" style={{ marginBottom: '30px' }}>
        <div className="card">
          <h3 style={{ color: '#94a3b8', fontSize: '14px' }}>TOTAL LICENSES</h3>
          <p style={{ fontSize: '36px', fontWeight: 'bold', marginTop: '8px' }}>{licenses.length}</p>
        </div>
        <div className="card">
          <h3 style={{ color: '#94a3b8', fontSize: '14px' }}>ACTIVE</h3>
          <p style={{ fontSize: '36px', fontWeight: 'bold', marginTop: '8px', color: '#34d399' }}>{activeCount}</p>
        </div>
        <div className="card">
          <h3 style={{ color: '#94a3b8', fontSize: '14px' }}>EXPIRED</h3>
          <p style={{ fontSize: '36px', fontWeight: 'bold', marginTop: '8px', color: '#f87171' }}>{licenses.length - activeCount}</p>
        </div>
        <div className="card">
          <h3 style={{ color: '#94a3b8', fontSize: '14px' }}>CREDITS</h3>
          <p style={{ fontSize: '36px', fontWeight: 'bold', marginTop: '8px', color: '#fbbf24' }}>${user?.credits?.toFixed(2)}</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginBottom: '20px' }}>
        <div className="card" style={{ flex: '1 1 600px', margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>Recent Licenses</h2>
            <Link to="/products" className="btn btn-primary" style={{ textDecoration: 'none' }}>+ Buy New</Link>
          </div>
          <table className="table">
            <thead><tr><th>Product</th><th>Key</th><th>Days</th><th>Expiry</th><th>Status</th></tr></thead>
            <tbody>
              {licenses.slice(0, 5).map(l => (
                <tr key={l.id}>
                  <td>{l.product_name}</td>
                  <td><code style={{background:'#0f172a',padding:'4px 8px',borderRadius:'4px'}}>{l.key}</code></td>
                  <td>{l.days}</td>
                  <td>{new Date(l.expiry_date).toLocaleDateString()}</td>
                  <td>
                    <span className={`badge ${new Date(l.expiry_date) > new Date() ? 'badge-success' : 'badge-danger'}`}>
                      {new Date(l.expiry_date) > new Date() ? 'Active' : 'Expired'}
                    </span>
                  </td>
                </tr>
              ))}
              {licenses.length === 0 && <tr><td colSpan="5" style={{textAlign:'center',color:'#64748b',padding:'30px'}}>No licenses yet</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ flex: '1 1 300px', margin: 0 }}>
          <h2 style={{ marginBottom: '15px' }}>🏆 Top Resellers</h2>
          {topResellers.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', borderBottom: '1px solid #334155' }}>
              <span style={{ fontWeight: 'bold', color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : '#b45309' }}>
                #{i + 1} {r.username}
              </span>
              <span style={{ color: '#34d399' }}>${r.total_recharged.toFixed(2)}</span>
            </div>
          ))}
          {topResellers.length === 0 && <p style={{ color: '#64748b', textAlign: 'center', padding: '20px 0' }}>No data yet</p>}
        </div>
      </div>

      {notifications.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>🔔 Notifications</h2>
          {notifications.slice(0, 3).map(n => (
            <div key={n.id} style={{ padding: '12px', borderBottom: '1px solid #334155' }}>
              <strong style={{color:'#fbbf24'}}>{n.title}</strong>
              <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>{n.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
