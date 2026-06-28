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
      <h1 className="page-title">💳 Payments</h1>
      
      <div className="card" style={{marginBottom:'24px',maxWidth:'560px'}}>
        <h3 style={{marginBottom:'20px', fontSize: '20px', fontWeight: '700'}}>Step 1: Create Payment</h3>
        <form onSubmit={handleCreate}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#e4e4e7', fontSize: '14px', fontWeight: '600' }}>Amount (USDT)</label>
          <input className="input" type="number" step="0.01" placeholder="Enter amount to add" value={amount} onChange={e=>setAmount(e.target.value)} required />
          <button type="submit" className="btn btn-success" style={{padding: '12px 24px', fontWeight: '700'}} disabled={loading}>{loading?'Creating...':'Create Payment'}</button>
        </form>
      </div>

      {activeOrder && (
        <div className="card" style={{marginBottom:'24px',maxWidth:'560px',border:'1px solid #3b82f6', boxShadow: '0 0 20px rgba(59, 130, 246, 0.1)'}}>
          <h3 style={{marginBottom:'20px',color:'#60a5fa', fontSize: '20px', fontWeight: '700'}}>Step 2: Send & Verify</h3>
          <div style={{padding:'20px',background:'rgba(255,255,255,0.03)',borderRadius:'12px',marginBottom:'20px', border: '1px solid rgba(255,255,255,0.05)'}}>
            <p style={{marginBottom: '12px'}}><strong>Amount:</strong> <span style={{color:'#fbbf24', fontSize: '18px'}}>${activeOrder.amount}</span></p>
            <p style={{marginBottom: '8px'}}><strong>Send USDT to:</strong></p>
            <code style={{display:'block',padding:'12px',background:'rgba(0,0,0,0.2)',borderRadius:'8px',marginTop:'4px',wordBreak:'break-all', fontSize: '14px', border: '1px solid rgba(255,255,255,0.1)'}}>{activeOrder.binanceAddress}</code>
            <p style={{color:'#a1a1aa',marginTop:'12px',fontSize:'14px', lineHeight: '1.5'}}>Send exactly ${activeOrder.amount} USDT. After sending, copy the Transaction ID (TXID) from Binance and paste below.</p>
          </div>
          <form onSubmit={handleVerify}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#e4e4e7', fontSize: '14px', fontWeight: '600' }}>Transaction ID</label>
            <input className="input" placeholder="Paste Transaction ID (TXID) from Binance" value={txId} onChange={e=>setTxId(e.target.value)} required />
            <button type="submit" className="btn btn-primary" style={{width:'100%', padding: '14px', fontSize: '16px', fontWeight: '800'}} disabled={verifyLoading}>
              {verifyLoading?'Verifying with Binance API...':'Verify & Add Credits'}
            </button>
          </form>
          {error && <div className="alert alert-danger" style={{marginTop:'20px'}}>{error}</div>}
          {success && <div className="alert alert-success" style={{marginTop:'20px'}}>{success}</div>}
        </div>
      )}

      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <h3 style={{padding:'24px', marginBottom:'0', fontSize: '20px', fontWeight: '700', borderBottom: '1px solid rgba(255,255,255,0.05)'}}>Payment History</h3>
        <div className="table-container" style={{ border: 'none', borderRadius: '0' }}>
          <table className="table">
            <thead><tr><th>Order ID</th><th>Amount</th><th>TX ID</th><th>Credits</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {payments.map(p=>(
                <tr key={p.id}>
                  <td><code>{p.order_id}</code></td><td><strong style={{color:'#34d399'}}>${p.amount}</strong></td>
                  <td><code>{p.tx_id||'-'}</code></td>
                  <td>{p.credits_added?`$${p.credits_added}`:'-'}</td>
                  <td><span className={`badge ${p.status==='completed'?'badge-success':'badge-pending'}`}>{p.status}</span></td>
                  <td>{new Date(p.date).toLocaleString()}</td>
                </tr>
              ))}
              {payments.length===0 && <tr><td colSpan="6" style={{textAlign:'center',color:'#71717a',padding:'60px'}}>No payments yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
