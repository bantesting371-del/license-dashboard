import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../context/AuthContext';

export default function Licenses() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState({});
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchLicenses = useCallback(async () => {
    try {
      const res = await api.get('/api/licenses/my');
      setLicenses(res.data);
    } catch { showToast('Failed to load licenses.', 'danger'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchLicenses(); }, [fetchLicenses]);

  const handleReset = async (id) => {
    setResetting(r => ({ ...r, [id]: true }));
    try {
      await api.post(`/api/licenses/${id}/reset`);
      showToast('HWID reset successfully.');
      fetchLicenses();
    } catch (e) {
      showToast(e.response?.data?.error || 'Reset failed.', 'danger');
    } finally {
      setResetting(r => ({ ...r, [id]: false }));
    }
  };

  const now = new Date();
  const isActive = (d) => new Date(d) > now;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" aria-label="Loading licenses" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h1 className="page-title" style={{ margin: 0 }}>My Licenses</h1>
        <Link to="/products" className="btn btn-primary">+ Buy License</Link>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`alert alert-${toast.type}`} role="alert" aria-live="polite">
          {toast.type === 'success' ? '✅' : '⚠️'} {toast.msg}
        </div>
      )}

      {/* Stats row */}
      {licenses.length > 0 && (
        <div className="grid-stats" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-label">Total</div>
            <div className="stat-value">{licenses.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>
              {licenses.filter(l => isActive(l.expiry_date)).length}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Expired</div>
            <div className="stat-value" style={{ color: 'var(--danger)' }}>
              {licenses.filter(l => !isActive(l.expiry_date)).length}
            </div>
          </div>
        </div>
      )}

      <div className="card card-flush">
        <div className="table-wrap">
          <table className="table" aria-label="License list">
            <thead>
              <tr>
                <th>Product</th>
                <th>License Key</th>
                <th>Duration</th>
                <th>Expiry</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {licenses.map(l => (
                <tr key={l.id}>
                  <td><strong>{l.product_name}</strong></td>
                  <td>
                    <code style={{ fontSize: 11.5, maxWidth: 200, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                      {l.key}
                    </code>
                  </td>
                  <td><span className="badge badge-muted">{l.days}d</span></td>
                  <td style={{ fontSize: 12.5, color: isActive(l.expiry_date) ? 'var(--text-secondary)' : 'var(--danger)' }}>
                    {new Date(l.expiry_date).toLocaleDateString()}
                  </td>
                  <td>
                    <span className={`badge ${isActive(l.expiry_date) ? 'badge-success' : 'badge-danger'}`}>
                      {isActive(l.expiry_date) ? '● Active' : '● Expired'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleReset(l.id)}
                      disabled={resetting[l.id]}
                      aria-label={`Reset HWID for ${l.product_name}`}
                    >
                      {resetting[l.id]
                        ? <><span className="spinner spinner-sm" aria-hidden="true" /> Resetting…</>
                        : 'Reset HWID'
                      }
                    </button>
                  </td>
                </tr>
              ))}
              {licenses.length === 0 && (
                <tr>
                  <td colSpan="6">
                    <div className="empty-state">
                      <div className="empty-state-icon">🔑</div>
                      <strong style={{ color: 'var(--text-secondary)' }}>No licenses yet</strong>
                      <p>Purchase a product to get your first license.</p>
                      <Link to="/products" className="btn btn-primary" style={{ marginTop: 14, display: 'inline-flex' }}>
                        Browse Products
                      </Link>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
