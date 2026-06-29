import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, api } from '../context/AuthContext';

// ─── Payments page ────────────────────────────────────────────────────────────
// Two-step deposit flow:
//   Step 1 – enter USDT amount → server creates order & returns deposit address
//   Step 2 – user sends USDT, pastes TXID → server verifies via Binance API
// History table beneath the form shows all past payments.
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div className={`toast toast-${type}`} role="alert" aria-live="assertive" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ display: 'flex' }}>
        {type === 'success' 
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
      </span>
      <span>{msg}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    completed: 'badge-success',
    pending:   'badge-warning',
    failed:    'badge-danger',
  };
  return (
    <span className={`badge ${map[status] || 'badge-muted'}`}>
      {status}
    </span>
  );
}

export default function Payments() {
  const { refreshUser }                         = useAuth();
  const [payments,      setPayments]            = useState([]);
  const [amount,        setAmount]              = useState('');
  const [txId,          setTxId]                = useState('');
  const [activeOrder,   setActiveOrder]         = useState(null);
  const [createLoading, setCreateLoading]       = useState(false);
  const [verifyLoading, setVerifyLoading]       = useState(false);
  const [copied,        setCopied]              = useState(false);
  const [toast,         setToast]               = useState({ msg: '', type: 'success' });
  const [histLoading,   setHistLoading]         = useState(true);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type }), 5000);
  };

  const fetchPayments = useCallback(async () => {
    try {
      const res = await api.get('/api/payments/my');
      setPayments(res.data);
    } catch { /* silent */ }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  /* Step 1 — create order */
  const handleCreate = async (e) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!amount || isNaN(val) || val <= 0) {
      showToast('Enter a valid amount greater than 0.', 'danger');
      return;
    }
    if (val > 100_000) {
      showToast('Amount too large. Contact support for large deposits.', 'danger');
      return;
    }
    setCreateLoading(true);
    try {
      const res = await api.post('/api/payments/create', { amount: val });
      setActiveOrder(res.data);
      setAmount('');
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to create payment. Try again.', 'danger');
    } finally {
      setCreateLoading(false);
    }
  };

  /* Step 2 — verify TXID */
  const handleVerify = async (e) => {
    e.preventDefault();
    const tx = txId.trim();
    if (!tx) { showToast('Paste your Transaction ID.', 'danger'); return; }
    if (!/^[a-fA-F0-9]{20,80}$/.test(tx)) {
      showToast('Invalid TXID format. Copy it directly from Binance.', 'danger');
      return;
    }
    setVerifyLoading(true);
    try {
      const res = await api.post('/api/payments/verify', {
        orderId: activeOrder.orderId,
        txId:    tx,
      });
      showToast(res.data.message || 'Credits added successfully!', 'success');
      setTxId('');
      setActiveOrder(null);
      refreshUser();
      fetchPayments();
    } catch (e) {
      const d = e.response?.data;
      showToast(d?.message || d?.error || 'Verification failed. Please try again.', 'danger');
    } finally {
      setVerifyLoading(false);
    }
  };

  const copyAddress = async () => {
    if (!activeOrder?.binanceAddress) return;
    try {
      await navigator.clipboard.writeText(activeOrder.binanceAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { /* clipboard blocked */ }
  };

  const cancelOrder = () => {
    setActiveOrder(null);
    setTxId('');
  };

  return (
    <div>
      <Toast msg={toast.msg} type={toast.type} />

      {/* ── header ── */}
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0 }}>Payments</h1>
        <span className="badge badge-muted">
          {payments.filter(p => p.status === 'completed').length} completed
        </span>
      </div>

      {/* ── deposit flow ── */}
      <div className="payment-flow">

        {/* Step 1 */}
        <div className="card payment-step" data-step="1">
          <div className="step-header">
            <span className="step-badge">Step 1</span>
            <h2 className="step-title">Set Amount</h2>
          </div>
          <p className="step-desc">Enter how many USDT you want to deposit.</p>

          <form onSubmit={handleCreate} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="dep-amount">Amount (USDT)</label>
              <div className="input-prefix-wrap">
                <span className="input-prefix">$</span>
                <input
                  id="dep-amount"
                  type="number"
                  step="0.01"
                  min="1"
                  max="100000"
                  className="input input-prefixed"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  disabled={!!activeOrder || createLoading}
                  aria-describedby="amount-hint"
                  required
                />
              </div>
              <p id="amount-hint" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
                Minimum: $1.00 USDT (TRC-20 / BEP-20)
              </p>
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={createLoading || !!activeOrder}
              aria-busy={createLoading}
            >
              {createLoading
                ? <><span className="spinner spinner-sm" aria-hidden="true" /> Creating order…</>
                : 'Create Payment Order'
              }
            </button>
          </form>
        </div>

        {/* Step 2 — only shown after order created */}
        {activeOrder && (
          <div className="card payment-step payment-step-active" data-step="2">
            <div className="step-header">
              <span className="step-badge step-badge-active">Step 2</span>
              <h2 className="step-title">Send & Verify</h2>
            </div>
            <p className="step-desc">
              Send exactly <strong style={{ color: 'var(--warning)' }}>
                ${activeOrder.amount} USDT
              </strong> to the address below, then paste the Transaction ID.
            </p>

            {/* amount highlight */}
            <div className="amount-highlight">
              <span className="ah-label">Amount to send</span>
              <span className="ah-value">${activeOrder.amount} USDT</span>
            </div>

            {/* deposit address */}
            <div className="form-group">
              <label className="form-label">Deposit Address</label>
              <div className="address-box">
                <code className="address-value">{activeOrder.binanceAddress}</code>
                <button
                  type="button"
                  className={`copy-btn ${copied ? 'copy-btn-done' : ''}`}
                  onClick={copyAddress}
                  aria-label={copied ? 'Copied!' : 'Copy deposit address'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  {copied ? <><span style={{ display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span> Copied!</> : <><span style={{ display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span> Copy</>}
                </button>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> Only send USDT. Do not send other coins.
              </p>
            </div>

            {/* txid input */}
            <form onSubmit={handleVerify} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="txid-input">
                  Transaction ID (TXID)
                </label>
                <input
                  id="txid-input"
                  type="text"
                  className="input"
                  placeholder="Paste TXID from Binance"
                  value={txId}
                  onChange={e => setTxId(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  required
                />
              </div>
              <button
                type="submit"
                className="btn btn-success btn-block"
                disabled={verifyLoading}
                aria-busy={verifyLoading}
              >
                {verifyLoading
                  ? <><span className="spinner spinner-sm" aria-hidden="true" /> Verifying with Binance…</>
                  : 'Verify & Add Credits'
                }
              </button>
            </form>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={cancelOrder}
              style={{ marginTop: 10, width: '100%' }}
            >
              Cancel this order
            </button>
          </div>
        )}
      </div>

      {/* ── history ── */}
      <div className="card card-flush" style={{ marginTop: 8 }}>
        <div className="card-list-header">
          <h2 className="section-title" style={{ margin: 0 }}>Payment History</h2>
          {!histLoading && (
            <span className="badge badge-muted">{payments.length}</span>
          )}
        </div>

        {histLoading ? (
          <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
            <div className="spinner" aria-hidden="true" />
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table" aria-label="Payment history">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Credits Added</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td>
                      <code style={{ fontSize: 11 }}>
                        {p.order_id?.slice(0, 20)}{p.order_id?.length > 20 ? '…' : ''}
                      </code>
                    </td>
                    <td>
                      <strong style={{ color: 'var(--text-primary)' }}>${p.amount}</strong>
                    </td>
                    <td>
                      {p.credits_added
                        ? <span className="badge badge-success">+${p.credits_added}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>
                      }
                    </td>
                    <td><StatusBadge status={p.status} /></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(p.date).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr>
                    <td colSpan="5">
                      <div className="empty-state">
                        <div className="empty-state-icon" style={{ display: 'flex', justifyContent: 'center' }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                        </div>
                        <p>No payment history yet</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
