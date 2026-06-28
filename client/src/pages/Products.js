import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

export default function Products() {
  const { user, refreshUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedDays, setSelectedDays] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    try { const res = await axios.get('/api/products'); setProducts(res.data); }
    catch (e) { console.error(e); }
  };

  const handleBuy = async () => {
    if (!selected || !selectedDays) return;
    setLoading(true);
    try {
      const res = await axios.post('/api/licenses/buy', { product_id: selected.id, days: selectedDays.days });
      alert(`✅ Purchase successful!\n\nKey: ${res.data.license}\nExpires: ${new Date(res.data.expiry).toLocaleDateString()}`);
      setSelected(null); setSelectedDays(null);
      refreshUser(); fetchProducts();
    } catch (error) {
      alert(error.response?.data?.error || 'Purchase failed');
    } finally { setLoading(false); }
  };

  return (
    <div>
      <h1 className="page-title">🛒 Products</h1>
      {!selected ? (
        <div className="grid">
          {products.map(p => (
            <div key={p.id} className="card" style={{cursor:'pointer', transition:'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'}} onClick={()=>setSelected(p)} onMouseEnter={e=>e.currentTarget.style.transform='translateY(-6px)'} onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}>
              {p.image_url && <img src={p.image_url} alt={p.name} style={{width:'100%',height:'200px',objectFit:'cover',borderRadius:'12px',marginBottom:'20px',boxShadow:'0 4px 12px rgba(0,0,0,0.2)'}} />}
              <h3 style={{ fontSize: '20px', fontWeight: '700' }}>{p.name}</h3>
              <p style={{color:'#a1a1aa',marginTop:'6px',fontSize:'14px'}}>Type: {p.key_type}</p>
              <div style={{marginTop:'16px', display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
                {p.available_days?.map(d => <span key={d.id} className="badge badge-success">{d.days} Days</span>)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{maxWidth:'640px',margin:'0 auto'}}>
          <button className="btn" style={{marginBottom:'24px',background:'rgba(255,255,255,0.05)',color:'white',border:'1px solid rgba(255,255,255,0.1)'}} onClick={()=>{setSelected(null);setSelectedDays(null);}}>← Back</button>
          {selected.image_url && <img src={selected.image_url} alt={selected.name} style={{width:'100%',height:'300px',objectFit:'cover',borderRadius:'12px',marginBottom:'24px'}} />}
          <h2 style={{ fontSize: '28px', fontWeight: '800' }}>{selected.name}</h2>
          <p style={{color:'#a1a1aa',margin:'12px 0', fontSize: '16px'}}>Type: {selected.key_type}</p>
          <h3 style={{margin:'24px 0 16px',fontSize:'18px', fontWeight: '700'}}>Select Duration:</h3>
          <div style={{display:'flex',gap:'12px',flexWrap:'wrap',marginBottom:'24px'}}>
            {selected.available_days?.map(d => (
              <button key={d.id} className="btn" style={{minWidth:'120px',background:selectedDays?.id===d.id?'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)':'rgba(255,255,255,0.05)',color:'white',border:selectedDays?.id===d.id?'none':'1px solid rgba(255,255,255,0.1)'}} onClick={()=>setSelectedDays(d)}>
                <div style={{fontWeight: '600'}}>{d.days} Days</div><div style={{fontSize:'22px',fontWeight:'800',marginTop:'6px'}}>${d.price}</div>
              </button>
            ))}
          </div>
          {selectedDays && (
            <div style={{marginBottom:'24px',padding:'20px',background:'rgba(255,255,255,0.03)',borderRadius:'12px', border:'1px solid rgba(255,255,255,0.05)'}}>
              <p style={{marginBottom: '8px'}}>Price: <strong style={{color:'#fbbf24', fontSize:'18px'}}>${selectedDays.price}</strong></p>
              <p style={{marginBottom: '8px'}}>Your Credits: <strong style={{fontSize:'18px'}}>${user?.credits?.toFixed(2)}</strong></p>
              <p>After: <strong style={{color:'#34d399', fontSize:'18px'}}>${(user?.credits - selectedDays.price).toFixed(2)}</strong></p>
            </div>
          )}
          <button className="btn btn-primary" style={{width:'100%', padding: '16px', fontSize: '18px', fontWeight: '800'}} onClick={handleBuy} disabled={!selectedDays||loading||user?.credits<selectedDays?.price}>
            {loading?'Processing...':'Buy Now'}
          </button>
          {user?.credits < selectedDays?.price && <p style={{color:'#ef4444',marginTop:'16px',textAlign:'center', fontWeight: '500'}}>Insufficient credits. <Link to="/payments" style={{color:'#3b82f6', textDecoration: 'none'}}>Add Credits</Link></p>}
        </div>
      )}
    </div>
  );
}
