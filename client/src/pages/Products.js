import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

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
      <h1 style={{ marginBottom: '25px' }}>🛒 Products</h1>
      {!selected ? (
        <div className="grid">
          {products.map(p => (
            <div key={p.id} className="card" style={{cursor:'pointer',transition:'transform 0.2s'}} onClick={()=>setSelected(p)} onMouseEnter={e=>e.currentTarget.style.transform='translateY(-5px)'} onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}>
              {p.image_url && <img src={p.image_url} alt={p.name} style={{width:'100%',height:'200px',objectFit:'cover',borderRadius:'8px',marginBottom:'15px'}} />}
              <h3>{p.name}</h3>
              <p style={{color:'#94a3b8',marginTop:'5px',fontSize:'14px'}}>Type: {p.key_type}</p>
              <div style={{marginTop:'12px'}}>
                {p.available_days?.map(d => <span key={d.id} className="badge badge-success" style={{marginRight:'6px'}}>{d.days}d</span>)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{maxWidth:'600px',margin:'0 auto'}}>
          <button className="btn" style={{marginBottom:'20px',background:'#334155',color:'white'}} onClick={()=>{setSelected(null);setSelectedDays(null);}}>← Back</button>
          {selected.image_url && <img src={selected.image_url} alt={selected.name} style={{width:'100%',height:'300px',objectFit:'cover',borderRadius:'8px',marginBottom:'20px'}} />}
          <h2>{selected.name}</h2>
          <p style={{color:'#94a3b8',margin:'10px 0'}}>Type: {selected.key_type}</p>
          <h3 style={{margin:'20px 0 12px',fontSize:'16px'}}>Select Duration:</h3>
          <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginBottom:'20px'}}>
            {selected.available_days?.map(d => (
              <button key={d.id} className="btn" style={{minWidth:'120px',background:selectedDays?.id===d.id?'#3b82f6':'#334155',color:'white'}} onClick={()=>setSelectedDays(d)}>
                <div>{d.days} Days</div><div style={{fontSize:'20px',fontWeight:'bold',marginTop:'4px'}}>${d.price}</div>
              </button>
            ))}
          </div>
          {selectedDays && (
            <div style={{marginBottom:'20px',padding:'15px',background:'#0f172a',borderRadius:'8px'}}>
              <p>Price: <strong style={{color:'#fbbf24'}}>${selectedDays.price}</strong></p>
              <p>Your Credits: <strong>${user?.credits?.toFixed(2)}</strong></p>
              <p>After: <strong style={{color:'#34d399'}}>${(user?.credits - selectedDays.price).toFixed(2)}</strong></p>
            </div>
          )}
          <button className="btn btn-success" style={{width:'100%'}} onClick={handleBuy} disabled={!selectedDays||loading||user?.credits<selectedDays?.price}>
            {loading?'Processing...':'Buy Now'}
          </button>
          {user?.credits < selectedDays?.price && <p style={{color:'#ef4444',marginTop:'12px',textAlign:'center'}}>Insufficient credits. <a href="/payments" style={{color:'#3b82f6'}}>Add Credits</a></p>}
        </div>
      )}
    </div>
  );
}
