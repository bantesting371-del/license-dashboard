import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

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

  useEffect(() => { fetchPayments(); }, []);

  const fetchPayments = async () => {
    try { const res = await axios.get('/api/payments/my'); setPayments(res.data); }
    catch (e) { console.error(e); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setSuccess('');
    try {
      const res = await axios.post('/api/payments/create', {amount: parseFloat(amount)});
      setActiveOrder(res.data);
      setAmount('');
    } catch (e) { setError(e.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!activeOrder) return;
    setVerifyLoading(true); setError(''); setSuccess('');
    try {
      const res = await axios.post('/api/payments/verify', {
        orderId: activeOrder.orderId,
        txId: txId.trim()
      });
      setSuccess(res.data.message);
      setTxId(''); setActiveOrder(null);
      refreshUser(); fetchPayments();
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Verification failed';
      setError(msg);
    } finally { setVerifyLoading(false); }
  };

  return (
    <div>
      <h1 style={{ marginBottom: '25px' }}>💳 Payments</h1>
      
      <div className="card" style={{marginBottom:'20px',maxWidth:'500px'}}>
        <h3 style={{marginBottom:'15px'}}>Step 1: Create Payment</h3>
        <form onSubmit={handleCreate}>
          <input className="input" type="number" step="0.01" placeholder="Amount (USDT)" value={amount} onChange={e=>setAmount(e.target.value)} required />
          <button type="submit" className="btn btn-success" disabled={loading}>{loading?'Creating...':'Create Payment'}</button>
        </form>
      </div>

      {activeOrder && (
        <div className="card" style={{marginBottom:'20px',maxWidth:'500px',border:'2px solid #3b82f6'}}>
          <h3 style={{marginBottom:'15px',color:'#3b82f6'}}>Step 2: Send & Verify</h3>
          <div style={{padding:'15px',background:'#0f172a',borderRadius:'8px',marginBottom:'15px'}}>
            <p><strong>Amount:</strong> <span style={{color:'#fbbf24'}}>${activeOrder.amount}</span></p>
            <p><strong>Send USDT to:</strong></p>
            <code style={{display:'block',padding:'10px',background:'#1e293b',borderRadius:'6px',marginTop:'5px',wordBreak:'break-all'}}>{activeOrder.binanceAddress}</code>
            <p style={{color:'#94a3b8',marginTop:'10px',fontSize:'13px'}}>Send exactly ${activeOrder.amount} USDT. After sending, copy the Transaction ID (TXID) from Binance and paste below.</p>
          </div>
          <form onSubmit={handleVerify}>
            <input className="input" placeholder="Paste Transaction ID (TXID) from Binance" value={txId} onChange={e=>setTxId(e.target.value)} required />
            <button type="submit" className="btn btn-primary" style={{width:'100%'}} disabled={verifyLoading}>
              {verifyLoading?'Verifying with Binance API...':'Verify & Add Credits'}
            </button>
          </form>
          {error && <div className="alert alert-danger" style={{marginTop:'15px'}}>{error}</div>}
          {success && <div className="alert alert-success" style={{marginTop:'15px'}}>{success}</div>}
        </div>
      )}

      <div className="card">
        <h3 style={{marginBottom:'15px'}}>Payment History</h3>
        <table className="table">
          <thead><tr><th>Order ID</th><th>Amount</th><th>TX ID</th><th>Credits</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            {payments.map(p=>(
              <tr key={p.id}>
                <td><code>{p.order_id}</code></td><td>${p.amount}</td>
                <td><code>{p.tx_id||'-'}</code></td>
                <td>{p.credits_added?`$${p.credits_added}`:'-'}</td>
                <td><span className={`badge ${p.status==='completed'?'badge-success':'badge-pending'}`}>{p.status}</span></td>
                <td>{new Date(p.date).toLocaleString()}</td>
              </tr>
            ))}
            {payments.length===0 && <tr><td colSpan="6" style={{textAlign:'center',color:'#64748b',padding:'40px'}}>No payments yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
