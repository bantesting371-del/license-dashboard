import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../context/AuthContext';

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      className={`alert alert-${toast.type}`}
      role="alert"
      aria-live="assertive"
      style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 400, maxWidth: 380, boxShadow: 'var(--shadow-lg)', margin: 0 }}
    >
      {toast.type === 'success' ? '✅' : '⚠️'} {toast.msg}
    </div>
  );
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('stats');
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [keys, setKeys] = useState([]);
  const [toast, setToast] = useState(null);

  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  const [newProduct, setNewProduct] = useState({ name: '', image_url: '', key_type: 'license_only', custom_key_pattern: '', days_config: [] });
  const [keyUpload, setKeyUpload] = useState({ product_id: '', days: '', keys: '' });
  const [creditForm, setCreditForm] = useState({ userId: '', amount: '', operation: 'add' });
  const [notifForm, setNotifForm] = useState({ title: '', message: '', target_user: '', is_global: true });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchAll = useCallback(async () => {
    try {
      const [s, u, p, pay, l, k] = await Promise.all([
        api.get('/api/admin/stats'),
        api.get('/api/admin/users'),
        api.get('/api/products'),
        api.get('/api/admin/payments'),
        api.get('/api/admin/licenses'),
        api.get('/api/admin/keys'),
      ]);
      setStats(s.data); setUsers(u.data); setProducts(p.data);
      setPayments(pay.data); setLicenses(l.data); setKeys(k.data);
    } catch (e) { showToast('Failed to load data.', 'danger'); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const guard = (fn) => async (...args) => {
    try { await fn(...args); }
    catch (e) { showToast(e.response?.data?.error || 'Action failed.', 'danger'); }
  };

  const handleCreateUser = guard(async (e) => {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.password) { showToast('Username and password required.', 'danger'); return; }
    await api.post('/api/auth/register', {
      username: newUser.username.trim().slice(0, 64),
      password: newUser.password.slice(0, 128),
      role: newUser.role,
    });
    setNewUser({ username: '', password: '', role: 'user' });
    fetchAll();
    showToast('User created successfully.');
  });

  const handleUpdateCredits = guard(async (e) => {
    e.preventDefault();
    if (!creditForm.userId || !creditForm.amount) { showToast('Select a user and enter amount.', 'danger'); return; }
    const amt = parseFloat(creditForm.amount);
    if (isNaN(amt) || amt < 0) { showToast('Invalid amount.', 'danger'); return; }
    await api.put(`/api/admin/users/${creditForm.userId}/credits`, { credits: amt, operation: creditForm.operation });
    setCreditForm({ userId: '', amount: '', operation: 'add' });
    fetchAll();
    showToast('Credits updated.');
  });

  const handleCreateProduct = guard(async (e) => {
    e.preventDefault();
    if (!newProduct.name.trim()) { showToast('Product name required.', 'danger'); return; }
    await api.post('/api/admin/products', {
      ...newProduct,
      name: newProduct.name.trim().slice(0, 128),
    });
    setNewProduct({ name: '', image_url: '', key_type: 'license_only', custom_key_pattern: '', days_config: [] });
    fetchAll();
    showToast('Product created.');
  });

  const handleUploadKeys = guard(async (e) => {
    e.preventDefault();
    if (!keyUpload.product_id || !keyUpload.days || !keyUpload.keys.trim()) {
      showToast('All fields required.', 'danger'); return;
    }
    const res = await api.post('/api/admin/keys/upload', keyUpload);
    setKeyUpload({ product_id: '', days: '', keys: '' });
    fetchAll();
    showToast(res.data.message);
  });

  const handleApprove = guard(async (id, amount) => {
    if (!window.confirm(`Approve payment of $${amount}?`)) return;
    await api.put(`/api/admin/payments/${id}/approve`, { credits: amount });
    fetchAll();
    showToast('Payment approved.');
  });

  const handleSendNotif = guard(async (e) => {
    e.preventDefault();
    if (!notifForm.title.trim() || !notifForm.message.trim()) { showToast('Title and message required.', 'danger'); return; }
    await api.post('/api/admin/notifications', notifForm);
    setNotifForm({ title: '', message: '', target_user: '', is_global: true });
    showToast('Notification sent.');
  });

  const handleDeleteProduct = guard(async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This also removes its keys.`)) return;
    await api.delete(`/api/admin/products/${id}`);
    fetchAll();
    showToast('Product deleted.');
  });

  const handleBan = guard(async (id, banned, username) => {
    if (!window.confirm(`${banned ? 'Unban' : 'Ban'} user "${username}"?`)) return;
    await api.put(`/api/admin/users/${id}/ban`, { is_banned: !banned });
    fetchAll();
    showToast(`User ${banned ? 'unbanned' : 'banned'}.`);
  });

  const handleDeleteUser = guard(async (id, username) => {
    if (!window.confirm(`Permanently delete user "${username}"?`)) return;
    await api.delete(`/api/admin/users/${id}`);
    fetchAll();
    showToast('User deleted.');
  });

  const addDay = () => setNewProduct({ ...newProduct, days_config: [...newProduct.days_config, { days: 7, price: 0 }] });
  const updateDay = (i, f, v) => {
    const d = [...newProduct.days_config];
    d[i][f] = f === 'days' ? parseInt(v) : parseFloat(v);
    setNewProduct({ ...newProduct, days_config: d });
  };
  const removeDay = (i) => setNewProduct({ ...newProduct, days_config: newProduct.days_config.filter((_, j) => j !== i) });

  const tabs = [
    { id: 'stats', label: '📊 Stats' },
    { id: 'users', label: '👥 Users' },
    { id: 'products', label: '📦 Products' },
    { id: 'keys', label: '🔑 Keys' },
    { id: 'payments', label: '💳 Payments', badge: payments.filter(p => p.status === 'pending').length },
    { id: 'licenses', label: '📋 Licenses' },
    { id: 'notifications', label: '🔔 Notify' },
  ];

  const now = new Date();

  return (
    <div>
      <Toast toast={toast} />
      <h1 className="page-title">Admin Dashboard</h1>

      {/* Tabs */}
      <div className="tabs" role="tablist" aria-label="Admin sections">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            role="tab"
            aria-selected={activeTab === t.id}
            style={{ position: 'relative' }}
          >
            {t.label}
            {t.badge > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: 'var(--danger)', color: '#fff',
                borderRadius: '50%', width: 16, height: 16,
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }} aria-label={`${t.badge} pending`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* STATS */}
      {activeTab === 'stats' && (
        <div className="grid-stats">
          {[
            { icon: '👥', label: 'Total Users', value: stats.totalUsers ?? '—', color: 'var(--brand-light)' },
            { icon: '💰', label: 'Total Revenue', value: `$${(stats.totalRevenue ?? 0).toFixed(2)}`, color: 'var(--success)' },
            { icon: '🔑', label: 'Keys Sold', value: stats.totalKeysSold ?? '—', color: 'var(--info)' },
            { icon: '✅', label: 'Active Licenses', value: stats.activeLicenses ?? '—', color: 'var(--warning)' },
            { icon: '📦', label: 'Products', value: stats.totalProducts ?? '—', color: 'var(--brand-light)' },
            { icon: '⏳', label: 'Pending Payments', value: stats.pendingPayments ?? '—', color: 'var(--danger)' },
          ].map(s => (
            <div className="stat-card" key={s.label}>
              <div className="stat-icon" style={{ background: `${s.color}18`, fontSize: 20 }}>{s.icon}</div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* USERS */}
      {activeTab === 'users' && (
        <div>
          {/* Create */}
          <div className="card">
            <h2 className="section-title">Create User</h2>
            <form onSubmit={handleCreateUser} noValidate>
              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" htmlFor="nu-username">Username</label>
                  <input id="nu-username" type="text" className="input" placeholder="Username" maxLength={64}
                    value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} required style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label className="form-label" htmlFor="nu-pass">Password</label>
                  <input id="nu-pass" type="password" className="input" placeholder="Password" maxLength={128}
                    value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} required style={{ marginBottom: 0 }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="nu-role">Role</label>
                  <select id="nu-role" className="select" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                    <option value="user">User</option>
                    <option value="reseller">Reseller</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" style={{ marginBottom: 0 }}>Create User</button>
              </div>
            </form>
          </div>

          {/* Credits */}
          <div className="card">
            <h2 className="section-title">Manage Credits</h2>
            <form onSubmit={handleUpdateCredits} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}>
                <div>
                  <label className="form-label" htmlFor="cr-user">User</label>
                  <select id="cr-user" className="select" value={creditForm.userId}
                    onChange={e => setCreditForm({ ...creditForm, userId: e.target.value })}>
                    <option value="">Select user…</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.username} (${u.credits})</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="cr-amount">Amount ($)</label>
                  <input id="cr-amount" type="number" step="0.01" min="0" className="input" placeholder="0.00" style={{ marginBottom: 0 }}
                    value={creditForm.amount} onChange={e => setCreditForm({ ...creditForm, amount: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="cr-op">Operation</label>
                  <select id="cr-op" className="select" value={creditForm.operation}
                    onChange={e => setCreditForm({ ...creditForm, operation: e.target.value })}>
                    <option value="add">Add</option>
                    <option value="remove">Remove</option>
                    <option value="set">Set</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary">Update</button>
              </div>
            </form>
          </div>

          {/* Users table */}
          <div className="card card-flush">
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="section-title" style={{ margin: 0 }}>All Users</h2>
              <span className="badge badge-muted">{users.length}</span>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table">
                <thead>
                  <tr><th>Username</th><th>Role</th><th>Balance</th><th>Recharged</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td><strong>{u.username}</strong></td>
                      <td><span className={`badge ${u.role === 'admin' ? 'badge-purple' : 'badge-muted'}`}>{u.role}</span></td>
                      <td><strong>${parseFloat(u.credits || 0).toFixed(2)}</strong></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>${parseFloat(u.total_recharged || 0).toFixed(2)}</td>
                      <td>
                        <span className={`badge ${u.is_banned ? 'badge-danger' : 'badge-success'}`}>
                          {u.is_banned ? 'Banned' : 'Active'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => handleBan(u.id, u.is_banned, u.username)}>
                            {u.is_banned ? 'Unban' : 'Ban'}
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteUser(u.id, u.username)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan="6"><div className="empty-state"><p>No users found</p></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCTS */}
      {activeTab === 'products' && (
        <div>
          <div className="card">
            <h2 className="section-title">Add Product</h2>
            <form onSubmit={handleCreateProduct} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Product Name *</label>
                  <input className="input" style={{ marginBottom: 0 }} placeholder="Product name" maxLength={128}
                    value={newProduct.name} onChange={e => setNewProduct({ ...newProduct, name: e.target.value })} required />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Image URL</label>
                  <input className="input" style={{ marginBottom: 0 }} placeholder="https://…" type="url"
                    value={newProduct.image_url} onChange={e => setNewProduct({ ...newProduct, image_url: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Key Type</label>
                  <select className="select" value={newProduct.key_type} onChange={e => setNewProduct({ ...newProduct, key_type: e.target.value })}>
                    <option value="license_only">License Key</option>
                    <option value="username_password">Username + Password</option>
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Custom Pattern (optional)</label>
                  <input className="input" style={{ marginBottom: 0 }} placeholder="e.g. XXXX-XXXX-XXXX"
                    value={newProduct.custom_key_pattern} onChange={e => setNewProduct({ ...newProduct, custom_key_pattern: e.target.value })} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label className="form-label" style={{ margin: 0 }}>Days &amp; Pricing</label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addDay}>+ Add Option</button>
                </div>
                {newProduct.days_config.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                    <select className="select" style={{ flex: 1 }} value={c.days} onChange={e => updateDay(i, 'days', e.target.value)}>
                      {[1, 3, 7, 14, 30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
                    </select>
                    <input className="input" type="number" step="0.01" min="0" placeholder="Price $"
                      style={{ flex: 1, marginBottom: 0 }} value={c.price} onChange={e => updateDay(i, 'price', e.target.value)} />
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeDay(i)}>✕</button>
                  </div>
                ))}
                {newProduct.days_config.length === 0 && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Add at least one pricing option.</p>
                )}
              </div>
              <button type="submit" className="btn btn-primary">Create Product</button>
            </form>
          </div>

          <div className="card card-flush">
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h2 className="section-title" style={{ margin: 0 }}>All Products</h2>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table">
                <thead><tr><th>Name</th><th>Type</th><th>Options</th><th>Actions</th></tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td><span className="badge badge-muted">{p.key_type}</span></td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {p.available_days?.map(d => (
                            <span key={d.id} className="badge badge-info">{d.days}d/$${d.price}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteProduct(p.id, p.name)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr><td colSpan="4"><div className="empty-state"><p>No products yet</p></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* KEYS */}
      {activeTab === 'keys' && (
        <div>
          <div className="card">
            <h2 className="section-title">Upload License Keys</h2>
            <form onSubmit={handleUploadKeys} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Product</label>
                  <select className="select" value={keyUpload.product_id} onChange={e => setKeyUpload({ ...keyUpload, product_id: e.target.value })} required>
                    <option value="">Select product…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Duration</label>
                  <select className="select" value={keyUpload.days} onChange={e => setKeyUpload({ ...keyUpload, days: e.target.value })} required>
                    <option value="">Select days…</option>
                    {[1, 3, 7, 14, 30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Keys (one per line)</label>
                <textarea
                  className="textarea"
                  rows={6}
                  placeholder={"KEY-XXXX-XXXX-XXXX\nKEY-YYYY-YYYY-YYYY\n…"}
                  value={keyUpload.keys}
                  onChange={e => setKeyUpload({ ...keyUpload, keys: e.target.value })}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Upload Keys
              </button>
            </form>
          </div>

          <div className="card card-flush">
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="section-title" style={{ margin: 0 }}>Key Pool</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="badge badge-success">{keys.filter(k => !k.is_used).length} available</span>
                <span className="badge badge-danger">{keys.filter(k => k.is_used).length} used</span>
              </div>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table">
                <thead><tr><th>Product</th><th>Days</th><th>Key</th><th>Status</th><th>Used by</th></tr></thead>
                <tbody>
                  {keys.slice(0, 100).map(k => (
                    <tr key={k.id}>
                      <td><strong>{k.product_name}</strong></td>
                      <td><span className="badge badge-muted">{k.days}d</span></td>
                      <td><code style={{ fontSize: 11 }}>{k.key_value}</code></td>
                      <td>
                        <span className={`badge ${k.is_used ? 'badge-danger' : 'badge-success'}`}>
                          {k.is_used ? 'Used' : 'Available'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{k.used_by || '—'}</td>
                    </tr>
                  ))}
                  {keys.length === 0 && (
                    <tr><td colSpan="5"><div className="empty-state"><p>No keys uploaded yet</p></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PAYMENTS */}
      {activeTab === 'payments' && (
        <div className="card card-flush">
          <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="section-title" style={{ margin: 0 }}>All Payments</h2>
            {payments.filter(p => p.status === 'pending').length > 0 && (
              <span className="badge badge-warning">
                {payments.filter(p => p.status === 'pending').length} pending
              </span>
            )}
          </div>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead><tr><th>User</th><th>Amount</th><th>TX ID</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.username}</strong></td>
                    <td><strong style={{ color: 'var(--success)' }}>${p.amount}</strong></td>
                    <td><code style={{ fontSize: 10.5 }}>{p.tx_id || '—'}</code></td>
                    <td>
                      <span className={`badge ${p.status === 'completed' ? 'badge-success' : p.status === 'pending' ? 'badge-warning' : 'badge-danger'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{new Date(p.date).toLocaleString()}</td>
                    <td>
                      {p.status === 'pending' && (
                        <button className="btn btn-sm btn-success" onClick={() => handleApprove(p.id, p.amount)}>
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr><td colSpan="6"><div className="empty-state"><p>No payments yet</p></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LICENSES */}
      {activeTab === 'licenses' && (
        <div className="card card-flush">
          <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
            <h2 className="section-title" style={{ margin: 0 }}>All Licenses</h2>
            <span className="badge badge-muted">{licenses.length} total</span>
          </div>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead><tr><th>User</th><th>Product</th><th>Key</th><th>Days</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                {licenses.map(l => {
                  const active = new Date(l.expiry_date) > now;
                  return (
                    <tr key={l.id}>
                      <td><strong>{l.username}</strong></td>
                      <td>{l.product_name}</td>
                      <td><code style={{ fontSize: 10.5 }}>{l.key}</code></td>
                      <td><span className="badge badge-muted">{l.days}d</span></td>
                      <td style={{ fontSize: 12 }}>{new Date(l.expiry_date).toLocaleDateString()}</td>
                      <td><span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>{active ? 'Active' : 'Expired'}</span></td>
                    </tr>
                  );
                })}
                {licenses.length === 0 && (
                  <tr><td colSpan="6"><div className="empty-state"><p>No licenses yet</p></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS */}
      {activeTab === 'notifications' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h2 className="section-title">Send Notification</h2>
          <form onSubmit={handleSendNotif} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="notif-title">Title *</label>
              <input id="notif-title" className="input" style={{ marginBottom: 0 }} placeholder="Notification title" maxLength={120}
                value={notifForm.title} onChange={e => setNotifForm({ ...notifForm, title: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="notif-msg">Message *</label>
              <textarea id="notif-msg" className="textarea" placeholder="Notification message…" rows={4} maxLength={500}
                value={notifForm.message} onChange={e => setNotifForm({ ...notifForm, message: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label">Target</label>
              <select className="select" value={notifForm.is_global ? 'global' : 'specific'}
                onChange={e => setNotifForm({ ...notifForm, is_global: e.target.value === 'global', target_user: '' })}>
                <option value="global">All users</option>
                <option value="specific">Specific user</option>
              </select>
            </div>
            {!notifForm.is_global && (
              <div className="form-group">
                <label className="form-label">Select User</label>
                <select className="select" value={notifForm.target_user}
                  onChange={e => setNotifForm({ ...notifForm, target_user: e.target.value })} required>
                  <option value="">Select user…</option>
                  {users.map(u => <option key={u.id} value={u.username}>{u.username}</option>)}
                </select>
              </div>
            )}
            <button type="submit" className="btn btn-primary">Send Notification</button>
          </form>
        </div>
      )}
    </div>
  );
}
