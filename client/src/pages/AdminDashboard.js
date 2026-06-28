import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('stats');
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [keys, setKeys] = useState([]);

  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  const [newProduct, setNewProduct] = useState({ name: '', image_url: '', key_type: 'license_only', custom_key_pattern: '', days_config: [] });
  const [keyUpload, setKeyUpload] = useState({ product_id: '', days: '', keys: '' });
  const [creditForm, setCreditForm] = useState({ userId: '', amount: '', operation: 'add' });
  const [notifForm, setNotifForm] = useState({ title: '', message: '', target_user: '', is_global: true });

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [s, u, p, pay, l, k] = await Promise.all([
        axios.get('/api/admin/stats'),
        axios.get('/api/admin/users'),
        axios.get('/api/products'),
        axios.get('/api/admin/payments'),
        axios.get('/api/admin/licenses'),
        axios.get('/api/admin/keys')
      ]);
      setStats(s.data); setUsers(u.data); setProducts(p.data);
      setPayments(pay.data); setLicenses(l.data); setKeys(k.data);
    } catch (e) { console.error(e); }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try { await axios.post('/api/auth/register', newUser); setNewUser({username:'',password:'',role:'user'}); fetchAll(); alert('User created'); }
    catch (e) { alert(e.response?.data?.error); }
  };

  const handleUpdateCredits = async (e) => {
    e.preventDefault();
    try { await axios.put(`/api/admin/users/${creditForm.userId}/credits`, {credits: parseFloat(creditForm.amount), operation: creditForm.operation}); fetchAll(); alert('Credits updated'); }
    catch (e) { alert(e.response?.data?.error); }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    try { await axios.post('/api/admin/products', newProduct); setNewProduct({name:'',image_url:'',key_type:'license_only',custom_key_pattern:'',days_config:[]}); fetchAll(); alert('Product created'); }
    catch (e) { alert(e.response?.data?.error); }
  };

  const handleUploadKeys = async (e) => {
    e.preventDefault();
    try { await axios.post('/api/admin/keys/upload', keyUpload); setKeyUpload({product_id:'',days:'',keys:''}); fetchAll(); alert('Keys uploaded'); }
    catch (e) { alert(e.response?.data?.error); }
  };

  const handleApprove = async (id, amount) => {
    try { await axios.put(`/api/admin/payments/${id}/approve`, {credits: amount}); fetchAll(); alert('Approved'); }
    catch (e) { alert(e.response?.data?.error); }
  };

  const handleSendNotif = async (e) => {
    e.preventDefault();
    try { await axios.post('/api/admin/notifications', notifForm); setNotifForm({title:'',message:'',target_user:'',is_global:true}); alert('Sent'); }
    catch (e) { alert(e.response?.data?.error); }
  };

  const handleDeleteProduct = async (id) => {
    if (!window.confirm('Delete?')) return;
    try { await axios.delete(`/api/admin/products/${id}`); fetchAll(); } catch (e) { alert(e.response?.data?.error); }
  };

  const handleBan = async (id, banned) => {
    try { await axios.put(`/api/admin/users/${id}/ban`, {is_banned: !banned}); fetchAll(); } catch (e) { alert(e.response?.data?.error); }
  };

  const handleDeleteUser = async (id) => {
    if (!window.confirm('Delete user?')) return;
    try { await axios.delete(`/api/admin/users/${id}`); fetchAll(); } catch (e) { alert(e.response?.data?.error); }
  };

  const addDay = () => setNewProduct({...newProduct, days_config: [...newProduct.days_config, {days:1, price:0}]});
  const updateDay = (i, f, v) => { const d=[...newProduct.days_config]; d[i][f]=f==='days'?parseInt(v):parseFloat(v); setNewProduct({...newProduct,days_config:d}); };
  const removeDay = (i) => setNewProduct({...newProduct, days_config: newProduct.days_config.filter((_,j)=>j!==i)});

  const tabs = [
    {id:'stats', label:'Statistics'}, {id:'users', label:'Users'}, {id:'products', label:'Products'},
    {id:'keys', label:'Upload Keys'}, {id:'payments', label:'Payments'}, {id:'licenses', label:'Licenses'}, {id:'notifications', label:'Notifications'}
  ];

  return (
    <div>
      <h1 className="page-title">⚡ Admin Dashboard</h1>
      <div className="tabs" style={{overflowX:'auto'}}>
        {tabs.map(t => <button key={t.id} className={`tab ${activeTab===t.id?'active':''}`} onClick={()=>setActiveTab(t.id)}>{t.label}</button>)}
      </div>

      {activeTab==='stats' && (
        <div className="grid">
          <div className="card"><h3 style={{color:'#94a3b8',fontSize:'13px'}}>TOTAL USERS</h3><p style={{fontSize:'32px',fontWeight:'bold',marginTop:'8px'}}>{stats.totalUsers}</p></div>
          <div className="card"><h3 style={{color:'#94a3b8',fontSize:'13px'}}>TOTAL REVENUE</h3><p style={{fontSize:'32px',fontWeight:'bold',marginTop:'8px',color:'#34d399'}}>${stats.totalRevenue?.toFixed(2)}</p></div>
          <div className="card"><h3 style={{color:'#94a3b8',fontSize:'13px'}}>KEYS SOLD</h3><p style={{fontSize:'32px',fontWeight:'bold',marginTop:'8px',color:'#3b82f6'}}>{stats.totalKeysSold}</p></div>
          <div className="card"><h3 style={{color:'#94a3b8',fontSize:'13px'}}>ACTIVE LICENSES</h3><p style={{fontSize:'32px',fontWeight:'bold',marginTop:'8px',color:'#fbbf24'}}>{stats.activeLicenses}</p></div>
          <div className="card"><h3 style={{color:'#94a3b8',fontSize:'13px'}}>PRODUCTS</h3><p style={{fontSize:'32px',fontWeight:'bold',marginTop:'8px'}}>{stats.totalProducts}</p></div>
          <div className="card"><h3 style={{color:'#94a3b8',fontSize:'13px'}}>PENDING PAYMENTS</h3><p style={{fontSize:'32px',fontWeight:'bold',marginTop:'8px',color:'#f87171'}}>{stats.pendingPayments}</p></div>
        </div>
      )}

      {activeTab==='users' && (
        <div>
          <div className="card" style={{marginBottom:'20px'}}>
            <h3 style={{marginBottom:'15px'}}>Create User</h3>
            <form onSubmit={handleCreateUser}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:'10px'}}>
                <input className="input" placeholder="Username" value={newUser.username} onChange={e=>setNewUser({...newUser,username:e.target.value})} />
                <input className="input" type="password" placeholder="Password" value={newUser.password} onChange={e=>setNewUser({...newUser,password:e.target.value})} />
                <select className="input" value={newUser.role} onChange={e=>setNewUser({...newUser,role:e.target.value})}>
                  <option value="user">User</option><option value="reseller">Reseller</option><option value="admin">Admin</option>
                </select>
                <button className="btn btn-success" type="submit">Create</button>
              </div>
            </form>
          </div>
          <div className="card" style={{marginBottom:'20px'}}>
            <h3 style={{marginBottom:'15px'}}>Manage Credits</h3>
            <form onSubmit={handleUpdateCredits}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:'10px'}}>
                <select className="input" value={creditForm.userId} onChange={e=>setCreditForm({...creditForm,userId:e.target.value})}>
                  <option value="">Select User</option>
                  {users.map(u=><option key={u.id} value={u.id}>{u.username} (${u.credits})</option>)}
                </select>
                <input className="input" type="number" step="0.01" placeholder="Amount" value={creditForm.amount} onChange={e=>setCreditForm({...creditForm,amount:e.target.value})} />
                <select className="input" value={creditForm.operation} onChange={e=>setCreditForm({...creditForm,operation:e.target.value})}>
                  <option value="add">Add</option><option value="remove">Remove</option><option value="set">Set</option>
                </select>
                <button className="btn btn-primary" type="submit">Update</button>
              </div>
            </form>
          </div>
          <div className="card">
            <h3 style={{marginBottom:'15px'}}>All Users</h3>
            <table className="table">
              <thead><tr><th>ID</th><th>Username</th><th>Role</th><th>Credits</th><th>Recharged</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map(u=>(
                  <tr key={u.id}>
                    <td>{u.id}</td><td>{u.username}</td>
                    <td><span className="badge badge-success">{u.role}</span></td>
                    <td>${u.credits}</td><td>${u.total_recharged}</td>
                    <td>{u.is_banned?<span className="badge badge-danger">Banned</span>:<span className="badge badge-success">Active</span>}</td>
                    <td>
                      <button className="btn btn-danger" style={{padding:'5px 10px',fontSize:'12px'}} onClick={()=>handleBan(u.id,u.is_banned)}>{u.is_banned?'Unban':'Ban'}</button>
                      <button className="btn btn-danger" style={{padding:'5px 10px',fontSize:'12px',marginLeft:'5px'}} onClick={()=>handleDeleteUser(u.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab==='products' && (
        <div>
          <div className="card" style={{marginBottom:'20px'}}>
            <h3 style={{marginBottom:'15px'}}>Add Product</h3>
            <form onSubmit={handleCreateProduct}>
              <input className="input" placeholder="Product Name" value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})} />
              <input className="input" placeholder="Image URL" value={newProduct.image_url} onChange={e=>setNewProduct({...newProduct,image_url:e.target.value})} />
              <select className="input" value={newProduct.key_type} onChange={e=>setNewProduct({...newProduct,key_type:e.target.value})}>
                <option value="license_only">License Only</option>
                <option value="username_password">Username + Password</option>
              </select>
              <input className="input" placeholder="Custom Key Pattern (optional)" value={newProduct.custom_key_pattern} onChange={e=>setNewProduct({...newProduct,custom_key_pattern:e.target.value})} />
              <div style={{margin:'15px 0'}}>
                <h4 style={{marginBottom:'10px',fontSize:'14px'}}>Days & Pricing</h4>
                {newProduct.days_config.map((c,i)=>(
                  <div key={i} style={{display:'flex',gap:'10px',marginBottom:'10px'}}>
                    <select className="input" style={{width:'auto'}} value={c.days} onChange={e=>updateDay(i,'days',e.target.value)}>
                      {[1,3,7,15,30,60,90].map(d=><option key={d} value={d}>{d} Days</option>)}
                    </select>
                    <input className="input" type="number" step="0.01" placeholder="Price $" style={{width:'auto'}} value={c.price} onChange={e=>updateDay(i,'price',e.target.value)} />
                    <button type="button" className="btn btn-danger" onClick={()=>removeDay(i)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn btn-primary" onClick={addDay}>+ Add Day Option</button>
              </div>
              <button type="submit" className="btn btn-success">Create Product</button>
            </form>
          </div>
          <div className="card">
            <h3 style={{marginBottom:'15px'}}>All Products</h3>
            <table className="table">
              <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Days/Prices</th><th>Actions</th></tr></thead>
              <tbody>
                {products.map(p=>(
                  <tr key={p.id}>
                    <td>{p.id}</td><td>{p.name}</td><td>{p.key_type}</td>
                    <td>{p.available_days?.map(d=><div key={d.id}>{d.days}d: ${d.price}</div>)}</td>
                    <td><button className="btn btn-danger" style={{padding:'5px 10px',fontSize:'12px'}} onClick={()=>handleDeleteProduct(p.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab==='keys' && (
        <div className="card">
          <h3 style={{marginBottom:'15px'}}>Upload License Keys</h3>
          <form onSubmit={handleUploadKeys}>
            <select className="input" value={keyUpload.product_id} onChange={e=>setKeyUpload({...keyUpload,product_id:e.target.value})}>
              <option value="">Select Product</option>
              {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="input" value={keyUpload.days} onChange={e=>setKeyUpload({...keyUpload,days:e.target.value})}>
              <option value="">Select Days</option>
              {[1,3,7,15,30,60,90].map(d=><option key={d} value={d}>{d} Days</option>)}
            </select>
            <textarea className="input" rows="8" placeholder="Paste keys (one per line)" value={keyUpload.keys} onChange={e=>setKeyUpload({...keyUpload,keys:e.target.value})} />
            <button type="submit" className="btn btn-success">Upload Keys</button>
          </form>
          <h3 style={{margin:'30px 0 15px'}}>Key Pool (Recent 50)</h3>
          <table className="table">
            <thead><tr><th>Product</th><th>Days</th><th>Key</th><th>Status</th><th>Used By</th></tr></thead>
            <tbody>
              {keys.slice(0,50).map(k=>(
                <tr key={k.id}>
                  <td>{k.product_name}</td><td>{k.days}</td><td><code>{k.key_value}</code></td>
                  <td>{k.is_used?<span className="badge badge-danger">Used</span>:<span className="badge badge-success">Available</span>}</td>
                  <td>{k.used_by||'-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab==='payments' && (
        <div className="card">
          <h3 style={{marginBottom:'15px'}}>All Payments</h3>
          <table className="table">
            <thead><tr><th>ID</th><th>User</th><th>Amount</th><th>TX ID</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
              {payments.map(p=>(
                <tr key={p.id}>
                  <td>{p.id}</td><td>{p.username}</td><td>${p.amount}</td>
                  <td><code>{p.tx_id||'-'}</code></td>
                  <td><span className={`badge ${p.status==='completed'?'badge-success':'badge-pending'}`}>{p.status}</span></td>
                  <td>{new Date(p.date).toLocaleString()}</td>
                  <td>{p.status==='pending' && <button className="btn btn-success" style={{padding:'5px 10px',fontSize:'12px'}} onClick={()=>handleApprove(p.id,p.amount)}>Approve</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab==='licenses' && (
        <div className="card">
          <h3 style={{marginBottom:'15px'}}>All Licenses</h3>
          <table className="table">
            <thead><tr><th>ID</th><th>User</th><th>Product</th><th>Key</th><th>Days</th><th>Expiry</th><th>Status</th></tr></thead>
            <tbody>
              {licenses.map(l=>(
                <tr key={l.id}>
                  <td>{l.id}</td><td>{l.username}</td><td>{l.product_name}</td><td><code>{l.key}</code></td>
                  <td>{l.days}</td><td>{new Date(l.expiry_date).toLocaleDateString()}</td>
                  <td><span className={`badge ${new Date(l.expiry_date)>new Date()?'badge-success':'badge-danger'}`}>{new Date(l.expiry_date)>new Date()?'Active':'Expired'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab==='notifications' && (
        <div className="card">
          <h3 style={{marginBottom:'15px'}}>Send Notification</h3>
          <form onSubmit={handleSendNotif}>
            <input className="input" placeholder="Title" value={notifForm.title} onChange={e=>setNotifForm({...notifForm,title:e.target.value})} />
            <textarea className="input" rows="4" placeholder="Message" value={notifForm.message} onChange={e=>setNotifForm({...notifForm,message:e.target.value})} />
            <select className="input" value={notifForm.is_global?'global':'specific'} onChange={e=>setNotifForm({...notifForm,is_global:e.target.value==='global',target_user:''})}>
              <option value="global">All Users</option><option value="specific">Specific User</option>
            </select>
            {!notifForm.is_global && (
              <select className="input" value={notifForm.target_user} onChange={e=>setNotifForm({...notifForm,target_user:e.target.value})}>
                <option value="">Select User</option>
                {users.map(u=><option key={u.id} value={u.username}>{u.username}</option>)}
              </select>
            )}
            <button type="submit" className="btn btn-primary">Send Notification</button>
          </form>
        </div>
      )}
    </div>
  );
}
