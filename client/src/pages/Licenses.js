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
      style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
    >
      <span style={{ display: 'flex' }}>
        {type === 'success' 
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
      </span>
      <span>{msg}</span>
      <button aria-label="Dismiss" className="toast-close" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
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
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
    >
      {copied ? <><span style={{ display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span> Copied</> : <><span style={{ display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span> Copy</>}
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
      const res = await api.post(`/api/licenses/${id}/reset`);
      showToast(res.data.message || `HWID reset requested for "${productName}".`);
      await fetchLicenses();
    } catch (e) {
      showToast(e.response?.data?.error || 'Reset request failed. Try again.', 'danger');
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
            <div className="empty-state-icon" style={{ display: 'flex', justifyContent: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
            </div>
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
                        <span style={{ color: urgent ? 'var(--warning)' : active ? 'var(--text-secondary)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {active
                            ? urgent
                              ? <><span style={{ display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> {days}d left</>
                              : new Date(l.expiry_date).toLocaleDateString()
                            : new Date(l.expiry_date).toLocaleDateString()
                          }
                        </span>
                      </td>

                      {/* status badge */}
                      <td>
                        <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          {active 
                            ? <><span style={{ display: 'flex', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'currentColor' }} /> Active</> 
                            : <><span style={{ display: 'flex', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'currentColor' }} /> Expired</>}
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
