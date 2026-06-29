import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../context/AuthContext';

// ─── Licenses page ────────────────────────────────────────────────────────────
// Shows all user licenses in a rich table.
// • Expired keys: greyed out, copy button disabled with tooltip
// • Active keys:  one-click copy to clipboard, formatted as "Key: <value>"
// • HWID reset:   allowed for active licenses only
// • Filter tabs:  All / Active / Expired
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onClose }) {
  if (!msg) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`toast toast-${type}`}
      onClick={onClose}
    >
      <span>{type === 'success' ? '✅' : '⚠️'}</span>
      <span>{msg}</span>
      <button aria-label="Dismiss" className="toast-close">✕</button>
    </div>
  );
}

function CopyKeyButton({ keyValue, active }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!active) return;
    try {
      // Format exactly as requested: "Key: <value>"
      await navigator.clipboard.writeText(`Key: ${keyValue}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — do nothing */
    }
  };

  if (!active) {
    return (
      <span
        className="copy-btn copy-btn-disabled"
        title="Expired licenses cannot be copied"
        aria-label="Key expired — cannot copy"
      >
        Expired
      </span>
    );
  }

  return (
    <button
      className={`copy-btn ${copied ? 'copy-btn-done' : ''}`}
      onClick={handleCopy}
      aria-label={copied ? 'Copied!' : 'Copy key'}
      title={`Copy: Key: ${keyValue}`}
    >
      {copied ? '✅ Copied' : '📋 Copy'}
    </button>
  );
}

const FILTERS = ['all', 'active', 'expired'];

export default function Licenses() {
  const [licenses,  setLicenses]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [resetting, setResetting] = useState({});
  const [filter,    setFilter]    = useState('all');
  const [toast,     setToast]     = useState({ msg: '', type: 'success' });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type }), 4000);
  };

  const fetchLicenses = useCallback(async () => {
    try {
      const res = await api.get('/api/licenses/my');
      setLicenses(res.data);
    } catch {
      showToast('Failed to load licenses. Please refresh.', 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLicenses(); }, [fetchLicenses]);

  const handleReset = async (id, productName) => {
    setResetting(r => ({ ...r, [id]: true }));
    try {
      await api.post(`/api/licenses/${id}/reset`);
      showToast(`HWID reset for "${productName}" — you can now log in from a new device.`);
      await fetchLicenses();
    } catch (e) {
      showToast(e.response?.data?.error || 'Reset failed. Try again.', 'danger');
    } finally {
      setResetting(r => ({ ...r, [id]: false }));
    }
  };

  const now      = new Date();
  const isActive = (d) => new Date(d) > now;

  const allLicenses     = licenses;
  const activeLicenses  = licenses.filter(l => isActive(l.expiry_date));
  const expiredLicenses = licenses.filter(l => !isActive(l.expiry_date));

  const displayed = filter === 'active'
    ? activeLicenses
    : filter === 'expired'
      ? expiredLicenses
      : allLicenses;

  const daysLeft = (expiry) => {
    const diff = Math.ceil((new Date(expiry) - now) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (loading) {
    return (
      <div className="page-loader" role="status">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div>
      <Toast
        msg={toast.msg}
        type={toast.type}
        onClose={() => setToast({ msg: '', type: toast.type })}
      />

      {/* ── page header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>My Licenses</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {activeLicenses.length} active · {expiredLicenses.length} expired
          </p>
        </div>
        <Link to="/products" className="btn btn-primary">+ Buy License</Link>
      </div>

      {/* ── stat pills ── */}
      {licenses.length > 0 && (
        <div className="license-stats">
          <div className="lic-stat">
            <span className="lic-stat-num">{allLicenses.length}</span>
            <span className="lic-stat-label">Total</span>
          </div>
          <div className="lic-stat" style={{ '--sc': 'var(--success)' }}>
            <span className="lic-stat-num" style={{ color: 'var(--success)' }}>
              {activeLicenses.length}
            </span>
            <span className="lic-stat-label">Active</span>
          </div>
          <div className="lic-stat" style={{ '--sc': 'var(--danger)' }}>
            <span className="lic-stat-num" style={{ color: 'var(--danger)' }}>
              {expiredLicenses.length}
            </span>
            <span className="lic-stat-label">Expired</span>
          </div>
        </div>
      )}

      {/* ── filter tabs ── */}
      {licenses.length > 0 && (
        <div className="filter-tabs" role="tablist" aria-label="Filter licenses">
          {FILTERS.map(f => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'all'     && <span className="ftab-count">{allLicenses.length}</span>}
              {f === 'active'  && <span className="ftab-count ftab-active">{activeLicenses.length}</span>}
              {f === 'expired' && <span className="ftab-count ftab-expired">{expiredLicenses.length}</span>}
            </button>
          ))}
        </div>
      )}

      {/* ── table / empty ── */}
      {displayed.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🔑</div>
            <strong style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              {filter === 'all' ? 'No licenses yet' : `No ${filter} licenses`}
            </strong>
            <p style={{ fontSize: 13 }}>
              {filter === 'all'
                ? 'Purchase a product to get your first license.'
                : `You don't have any ${filter} licenses right now.`}
            </p>
            {filter === 'all' && (
              <Link to="/products" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex' }}>
                Browse Products
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="card card-flush">
          <div className="table-wrap">
            <table className="table" aria-label="License list">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>License Key</th>
                  <th>Duration</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Copy</th>
                  <th>HWID</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(l => {
                  const active  = isActive(l.expiry_date);
                  const days    = daysLeft(l.expiry_date);
                  const urgent  = active && days <= 3;
                  return (
                    <tr key={l.id} className={!active ? 'row-expired' : ''}>

                      {/* product */}
                      <td>
                        <strong style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {l.product_name}
                        </strong>
                      </td>

                      {/* key — blurred if expired */}
                      <td>
                        <span
                          className={`key-cell ${active ? '' : 'key-expired'}`}
                          aria-label={active ? `Key: ${l.key}` : 'Expired key — hidden'}
                        >
                          {l.key}
                        </span>
                      </td>

                      {/* duration */}
                      <td>
                        <span className="badge badge-muted">{l.days}d</span>
                      </td>

                      {/* expiry */}
                      <td style={{ fontSize: 12.5 }}>
                        <span style={{ color: urgent ? 'var(--warning)' : active ? 'var(--text-secondary)' : 'var(--danger)' }}>
                          {active
                            ? urgent
                              ? `⚠️ ${days}d left`
                              : new Date(l.expiry_date).toLocaleDateString()
                            : new Date(l.expiry_date).toLocaleDateString()
                          }
                        </span>
                      </td>

                      {/* status badge */}
                      <td>
                        <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
                          {active ? '● Active' : '● Expired'}
                        </span>
                      </td>

                      {/* copy button — disabled when expired */}
                      <td>
                        <CopyKeyButton keyValue={l.key} active={active} />
                      </td>

                      {/* HWID reset */}
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleReset(l.id, l.product_name)}
                          disabled={resetting[l.id] || !active}
                          title={!active ? 'Cannot reset an expired license' : 'Reset HWID'}
                          aria-label={`Reset HWID for ${l.product_name}`}
                        >
                          {resetting[l.id]
                            ? <><span className="spinner spinner-sm" aria-hidden="true" /> …</>
                            : 'Reset'
                          }
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
