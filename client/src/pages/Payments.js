import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, api } from '../context/AuthContext';

export default function Payments() {
  const { refreshUser } = useAuth();
  const [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState('');
  const [txId, setTxId] = useState('');
  const [activeOrder, setActiveOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);

  const fetchPayments = useCallback(async () => {
    try {
      const res = await api.get('/api/payments/my');
      setPayments(res.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0 || val > 100000) { setError('Enter a valid amount.'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      const res = await api.post('/api/payments/create', { amount: val });
      setActiveOrder(res.data);
      setAmount('');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create payment.');
    } finally { setLoading(false); }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!activeOrder) return;
    const tx = txId.trim();
    if (!tx) { setError('Transaction ID is required.'); return; }
    // Basic TXID format check
    if (!/^[a-fA-F0-9]{20,80}$/.test(tx)) {
      setError('Transaction ID appears invalid. Please copy it directly from Binance.');
      return;
    }
    setVerifyLoading(true); setError(''); setSuccess('');
    try {
      const res = await api.post('/api/payments/verify', {
        orderId: activeOrder.orderId,
        txId: tx,
      });
      setSuccess(res.data.message);
      setTxId(''); setActiveOrder(null);
      refreshUser(); fetchPayments();
    } catch (e) {
      const d = e.response?.data;
      setError(d?.message || d?.error || 'Verification failed. Please try again.');
    } finally { setVerifyLoading(false); }
  };

  const copyAddress = () => {
    if (!activeOrder?.binanceAddress) return;
    navigator.clipboard?.writeText(activeOrder.binanceAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const statusBadge = (s) => {
    const map = { completed: 'badge-success', pending: 'badge-warning', failed: 'badge-danger' };
    return <span className={`badge ${map[s] || 'badge-muted'}`}>{s}</span>;
  };

  return (
    <div>
      <h1 className="page-title">Payments</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 20 }}>
        {/* Step 1 */}
        <div className="card" style={{ flex: '1 1 320px', margin: 0 }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
            Step 1 — Set Amount
          </h2>
          {error && !activeOrder && (
            <div className="alert alert-danger" role="alert">{error}</div>
          )}
          <form onSubmit={handleCreate} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="amount">Amount (USDT)</label>
              <input
                id="amount"
                type="number"
                step="0.01"
                min="1"
                max="100000"
                className="input"
                placeholder="e.g. 50.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={!!activeOrder}
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading || !!activeOrder}
              aria-busy={loading}
            >
              {loading ? <><span className="spinner spinner-sm" aria-hidden="true" /> Creating…</> : 'Create Payment'}
            </button>
          </form>
        </div>

        {/* Step 2 */}
        {activeOrder && (
          <div className="card" style={{ flex: '1 1 320px', margin: 0, borderColor: 'var(--border-default)' }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
              Step 2 — Send & Verify
            </h2>

            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              Send exactly <strong>${activeOrder.amount} USDT</strong> to the address below, then paste your Transaction ID.
            </div>

            <div className="form-group">
              <label className="form-label">Deposit Address (USDT)</label>
              <div style={{ position: 'relative' }}>
                <code className="code-block" style={{ paddingRight: 80 }}>{activeOrder.binanceAddress}</code>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={copyAddress}
                  style={{ position: 'absolute', top: 8, right: 8 }}
                  aria-label="Copy deposit address"
                >
                  {copied ? '✅ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {(error || success) && (
              <div className={`alert alert-${success ? 'success' : 'danger'}`} role="alert">
                {success || error}
              </div>
            )}

            <form onSubmit={handleVerify} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="txid">Transaction ID (TXID)</label>
                <input
                  id="txid"
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
                className="btn btn-primary btn-block"
                disabled={verifyLoading}
                aria-busy={verifyLoading}
              >
                {verifyLoading
                  ? <><span className="spinner spinner-sm" aria-hidden="true" /> Verifying…</>
                  : 'Verify & Add Credits'}
              </button>
            </form>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setActiveOrder(null); setError(''); setSuccess(''); }}
              style={{ marginTop: 12, width: '100%' }}
            >
              Cancel this order
            </button>
          </div>
        )}
      </div>

      {success && !activeOrder && (
        <div className="alert alert-success" role="status">{success}</div>
      )}

      {/* History */}
      <div className="card card-flush">
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Payment History</h2>
          <span className="badge badge-muted">{payments.length}</span>
        </div>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table" aria-label="Payment history">
            <thead>
              <tr>
                <th>Order</th>
                <th>Amount</th>
                <th>Credits</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td><code style={{ fontSize: 11 }}>{p.order_id}</code></td>
                  <td><strong style={{ color: 'var(--success)' }}>${p.amount}</strong></td>
                  <td>{p.credits_added ? <span className="badge badge-success">+${p.credits_added}</span> : '—'}</td>
                  <td>{statusBadge(p.status)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(p.date).toLocaleString()}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan="5">
                    <div className="empty-state">
                      <div className="empty-state-icon">💳</div>
                      <p>No payment history yet</p>
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
