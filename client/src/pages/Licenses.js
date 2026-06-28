import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

export default function Licenses() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState({});

  useEffect(() => { fetchLicenses(); }, []);

  const fetchLicenses = async () => {
    try { const res = await axios.get('/api/licenses/my'); setLicenses(res.data); }
    catch (e) { console.error(e); }
  };

  const handleReset = async (id) => {
    setLoading({...loading,[id]:true});
    try { await axios.post(`/api/licenses/${id}/reset`); alert('HWID reset successful'); fetchLicenses(); }
    catch (e) { alert(e.response?.data?.error || 'Reset failed'); }
    finally { setLoading({...loading,[id]:false}); }
  };

  const isExpired = (d) => new Date(d) < new Date();

  return (
    <div>
      <h1 className="page-title">🔑 My Licenses</h1>
      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <div className="table-container" style={{ border: 'none', borderRadius: '0' }}>
          <table className="table">
            <thead><tr><th>Product</th><th>Key</th><th>Days</th><th>Expiry</th><th>Status</th><th>HWID Reset</th></tr></thead>
            <tbody>
              {licenses.map(l=>(
                <tr key={l.id}>
                  <td>{l.product_name}</td>
                  <td><code>{l.key}</code></td>
                  <td>{l.days}</td>
                  <td>{new Date(l.expiry_date).toLocaleDateString()}</td>
                  <td><span className={`badge ${isExpired(l.expiry_date)?'badge-danger':'badge-success'}`}>{isExpired(l.expiry_date)?'Expired':'Active'}</span></td>
                  <td>
                    <button className="btn btn-primary" style={{padding:'6px 14px',fontSize:'13px'}} onClick={()=>handleReset(l.id)} disabled={loading[l.id]}>
                      {loading[l.id]?'...':'Reset HWID'}
                    </button>
                  </td>
                </tr>
              ))}
              {licenses.length===0 && <tr><td colSpan="6" style={{textAlign:'center',color:'#71717a',padding:'60px'}}>No licenses yet. <Link to="/products" style={{color:'#3b82f6', textDecoration: 'none'}}>Buy one</Link></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
