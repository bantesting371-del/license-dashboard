import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../context/AuthContext';

//  Admin Dashboard 
// Full admin panel with tabbed navigation.
// Tabs: Stats  Users  Products  Keys  Payments  Licenses  Notifications
//
// Key fixes vs previous version:
//  ... fetchAll uses Promise.allSettled so ONE failing endpoint never blocks the rest
//  ... Each data slice has its own error state ... shown inline per section
//  ... Product image_url is truly optional (not validated, not required)
//  ... Product create sends days_config as JSON string if backend expects it
//  ... Key upload supports multi-line paste, trims blank lines
//  ... Payment approve with confirmation dialog
//  ... Admin register uses /api/auth/register (admin-only route)
//  ... All destructive actions require window.confirm
//  ... Toast is fixed-position bottom-right, auto-dismisses
// 

//  Icons
const ICONS = {
  stats: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>,
  users: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  products: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  keys: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
  payments: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  licenses: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>,
  notify: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  revenue: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>,
  success: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  warning: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  userPass: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  active: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  banned: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  refresh: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
};

//  Toast 
function Toast({ toast }) {
  if (!toast || !toast.msg) return null;
  return (
    <div
      className={`toast toast-${toast.type}`}
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 500,
        maxWidth: 380, boxShadow: 'var(--shadow-lg)', margin: 0,
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
        {toast.type === 'success' ? ICONS.success : ICONS.warning}
      </span>
      <span>{toast.msg}</span>
    </div>
  );
}

//  SectionError 
function SectionError({ message, onRetry }) {
  return (
    <div className="alert alert-danger" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span> {message}</span>
      {onRetry && (
        <button className="btn btn-sm btn-ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

//  StatCard 
function StatCard({ icon, label, value, color, sub }) {
  return (
    <div className="stat-card" style={{ gap: 6 }}>
      <div className="stat-icon" style={{ background: `${color}1a`, fontSize: 20 }}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value ?? '...'}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

//  DayRow 
function DayRow({ config, index, onChange, onRemove }) {
  const DAY_OPTIONS = [1, 3, 7, 15, 30, 60, 90, 180, 365];
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <select
        className="select"
        style={{ flex: 1 }}
        value={config.days}
        onChange={e => onChange(index, 'days', parseInt(e.target.value, 10))}
        aria-label="Duration in days"
      >
        {DAY_OPTIONS.map(d => (
          <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>
        ))}
      </select>
      <div className="input-prefix-wrap" style={{ flex: 1 }}>
        <span className="input-prefix">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          className="input input-prefixed"
          style={{ marginBottom: 0 }}
          placeholder="Price"
          value={config.price}
          onChange={e => onChange(index, 'price', parseFloat(e.target.value) || 0)}
          aria-label="Price in USD"
        />
      </div>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        onClick={() => onRemove(index)}
        aria-label={`Remove ${config.days}-day option`}
      >
        
      </button>
    </div>
  );
}

//  Main Component 
export default function AdminDashboard() {
  //  state 
  const [activeTab, setActiveTab] = useState('stats');
  const [toast,     setToast]     = useState({ msg: '', type: 'success' });

  // data slices
  const [stats,    setStats]    = useState({});
  const [users,    setUsers]    = useState([]);
  const [products, setProducts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [keys,     setKeys]     = useState([]);
  const [hwidRequests, setHwidRequests] = useState([]);

  // per-section error messages
  const [errors, setErrors] = useState({});

  // loading states
  const [globalLoading, setGlobalLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({});

  // forms
  const [newUser, setNewUser] = useState({
    username: '', password: '', role: 'user',
  });
  const [newProduct, setNewProduct] = useState({
    name: '', image_url: '', key_type: 'license_only',
    custom_key_pattern: '', days_config: [],
  });
  const [editingProductId, setEditingProductId] = useState(null);

  const [keyUpload, setKeyUpload] = useState({
    product_id: '', days: '', keys: '',
  });
  const [creditForm, setCreditForm] = useState({
    userId: '', amount: '', operation: 'add',
  });
  const [notifForm, setNotifForm] = useState({
    title: '', message: '', target_user: '', is_global: true,
  });
  const [keySearch, setKeySearch] = useState('');
  const [licSearch, setLicSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');

  const toastTimer = useRef(null);

  //  helpers 
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast({ msg: '', type: 'success' }), 4000);
  }, []);

  const setActionBusy = (key, val) =>
    setActionLoading(prev => ({ ...prev, [key]: val }));

  //  fetch 
  const fetchAll = useCallback(async () => {
    setGlobalLoading(true);
    const endpoints = [
      { key: 'stats',    url: '/api/admin/stats' },
      { key: 'users',    url: '/api/admin/users' },
      { key: 'products', url: '/api/products' },
      { key: 'payments', url: '/api/admin/payments' },
      { key: 'licenses', url: '/api/admin/licenses' },
      { key: 'keys',     url: '/api/admin/keys' },
      { key: 'hwid',     url: '/api/admin/hwid-requests' },
    ];

    const results = await Promise.allSettled(
      endpoints.map(ep => api.get(ep.url))
    );

    const newErrors = {};
    results.forEach((res, i) => {
      const { key } = endpoints[i];
      if (res.status === 'fulfilled') {
        const data = res.value.data;
        if (key === 'stats')    setStats(data);
        if (key === 'users')    setUsers(data);
        if (key === 'products') setProducts(data);
        if (key === 'payments') setPayments(data);
        if (key === 'licenses') setLicenses(data);
        if (key === 'keys')     setKeys(data);
        if (key === 'hwid')     setHwidRequests(data);
        newErrors[key] = null;
      } else {
        newErrors[key] = res.reason?.response?.data?.error
          || `Failed to load ${key}`;
      }
    });
    setErrors(newErrors);
    setGlobalLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  //  guard wrapper 
  const guard = (key, fn) => async (...args) => {
    setActionBusy(key, true);
    try {
      await fn(...args);
    } catch (e) {
      showToast(e.response?.data?.error || 'Action failed. Please try again.', 'danger');
    } finally {
      setActionBusy(key, false);
    }
  };

  const handleApproveHwid = guard('hwid', async (id) => {
    if (!window.confirm('Approve this HWID reset?')) return;
    await api.post(`/api/admin/hwid-requests/${id}/approve`);
    await fetchAll();
    showToast('HWID reset approved.');
  });

  const handleRejectHwid = guard('hwid', async (id) => {
    if (!window.confirm('Reject this HWID reset?')) return;
    await api.post(`/api/admin/hwid-requests/${id}/reject`);
    await fetchAll();
    showToast('HWID reset rejected.');
  });

  //  handlers 
  const handleCreateUser = guard('createUser', async (e) => {
    e.preventDefault();
    const u = newUser.username.trim().slice(0, 64);
    const p = newUser.password.slice(0, 128);
    if (!u || !p) { showToast('Username and password are required.', 'danger'); return; }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(u)) {
      showToast('Username: 3...32 chars, letters/numbers/_ or -.', 'danger'); return;
    }
    if (p.length < 6) { showToast('Password must be at least 6 characters.', 'danger'); return; }
    await api.post('/api/auth/register', { username: u, password: p, role: newUser.role });
    setNewUser({ username: '', password: '', role: 'user' });
    await fetchAll();
    showToast(`User "${u}" created successfully.`);
  });

  const handleUpdateCredits = guard('credits', async (e) => {
    e.preventDefault();
    if (!creditForm.userId) { showToast('Select a user.', 'danger'); return; }
    const amt = parseFloat(creditForm.amount);
    if (isNaN(amt) || amt < 0) { showToast('Enter a valid amount.', 'danger'); return; }
    await api.put(`/api/admin/users/${creditForm.userId}/credits`, {
      credits: amt, operation: creditForm.operation,
    });
    setCreditForm({ userId: '', amount: '', operation: 'add' });
    await fetchAll();
    showToast('Credits updated successfully.');
  });

  const handleSaveProduct = guard('saveProduct', async (e) => {
    e.preventDefault();
    const name = newProduct.name.trim().slice(0, 128);
    if (!name) { showToast('Product name is required.', 'danger'); return; }
    if (newProduct.days_config.length === 0) {
      showToast('Add at least one pricing option.', 'danger'); return;
    }

    const payload = {
      name,
      key_type:            newProduct.key_type,
      custom_key_pattern:  newProduct.custom_key_pattern.trim(),
      days_config:         newProduct.days_config,
      ...(newProduct.image_url.trim() ? { image_url: newProduct.image_url.trim() } : {}),
    };

    if (editingProductId) {
      await api.put(`/api/admin/products/${editingProductId}`, payload);
      showToast(`Product "${name}" updated.`);
    } else {
      await api.post('/api/admin/products', payload);
      showToast(`Product "${name}" created.`);
    }

    setNewProduct({ name: '', image_url: '', key_type: 'license_only', custom_key_pattern: '', days_config: [] });
    setEditingProductId(null);
    await fetchAll();
  });

  const handleEditProductClick = (p) => {
    setEditingProductId(p.id);
    setNewProduct({
      name: p.name || '',
      image_url: p.image_url || '',
      key_type: p.key_type || 'license_only',
      custom_key_pattern: p.custom_key_pattern || '',
      days_config: p.available_days || [],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditProduct = () => {
    setEditingProductId(null);
    setNewProduct({ name: '', image_url: '', key_type: 'license_only', custom_key_pattern: '', days_config: [] });
  };

  const handleDeleteProduct = guard('deleteProduct', async (id, name) => {
    if (!window.confirm(`Delete product "${name}"?\nThis will also remove all associated keys.`)) return;
    await api.delete(`/api/admin/products/${id}`);
    await fetchAll();
    showToast(`Product "${name}" deleted.`);
  });

  const handleDeleteKey = guard('deleteKey', async (id) => {
    if (!window.confirm('Delete this key?')) return;
    await api.delete(`/api/admin/keys/${id}`);
    await fetchAll();
    showToast('Key deleted.');
  });

  const handleUploadKeys = guard('uploadKeys', async (e) => {
    e.preventDefault();
    if (!keyUpload.product_id) { showToast('Select a product.', 'danger'); return; }
    if (!keyUpload.days)       { showToast('Select a duration.', 'danger'); return; }
    const cleaned = keyUpload.keys
      .split('\n')
      .map(k => k.trim())
      .filter(k => k.length > 0)
      .join('\n');
    if (!cleaned) { showToast('Paste at least one key.', 'danger'); return; }
    const res = await api.post('/api/admin/keys/upload', {
      ...keyUpload,
      keys: cleaned,
    });
    setKeyUpload({ product_id: '', days: '', keys: '' });
    await fetchAll();
    showToast(res.data.message || 'Keys uploaded successfully.');
  });

  const handleApprovePayment = guard('approve', async (id, amount, username) => {
    if (!window.confirm(`Approve $${amount} payment for "${username}"?`)) return;
    await api.put(`/api/admin/payments/${id}/approve`, { credits: amount });
    await fetchAll();
    showToast(`Payment for "${username}" approved.`);
  });

  const handleRejectPayment = guard('reject', async (id, amount, username) => {
    if (!window.confirm(`Reject $${amount} payment for "${username}"?`)) return;
    await api.put(`/api/admin/payments/${id}/reject`);
    await fetchAll();
    showToast(`Payment for "${username}" rejected.`);
  });

  const handleBanUser = guard('ban', async (id, isBanned, username) => {
    const action = isBanned ? 'unban' : 'ban';
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} user "${username}"?`)) return;
    await api.put(`/api/admin/users/${id}/ban`, { is_banned: !isBanned });
    await fetchAll();
    showToast(`User "${username}" ${action}ned.`);
  });

  const handleDeleteUser = guard('deleteUser', async (id, username) => {
    if (!window.confirm(`Permanently delete user "${username}"?\nThis cannot be undone.`)) return;
    await api.delete(`/api/admin/users/${id}`);
    await fetchAll();
    showToast(`User "${username}" deleted.`);
  });

  const handleSendNotif = guard('notif', async (e) => {
    e.preventDefault();
    if (!notifForm.title.trim()) { showToast('Title is required.', 'danger'); return; }
    if (!notifForm.message.trim()) { showToast('Message is required.', 'danger'); return; }
    if (!notifForm.is_global && !notifForm.target_user) {
      showToast('Select a target user.', 'danger'); return;
    }
    await api.post('/api/admin/notifications', {
      title:       notifForm.title.trim().slice(0, 120),
      message:     notifForm.message.trim().slice(0, 500),
      is_global:   notifForm.is_global,
      target_user: notifForm.is_global ? '' : notifForm.target_user,
    });
    setNotifForm({ title: '', message: '', target_user: '', is_global: true });
    showToast('Notification sent successfully.');
  });

  // days_config helpers
  const addDayOption = () =>
    setNewProduct(p => ({ ...p, days_config: [...p.days_config, { days: 7, price: 0 }] }));
  const updateDayOption = (i, field, value) =>
    setNewProduct(p => {
      const cfg = [...p.days_config];
      cfg[i] = { ...cfg[i], [field]: value };
      return { ...p, days_config: cfg };
    });
  const removeDayOption = (i) =>
    setNewProduct(p => ({ ...p, days_config: p.days_config.filter((_, j) => j !== i) }));

  //  derived 
  const now              = new Date();
  const pendingPayments  = payments.filter(p => p.status === 'pending');
  const filteredUsers    = users.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase()));
  const filteredKeys     = keys.filter(k =>
    !keySearch || k.key_value?.toLowerCase().includes(keySearch.toLowerCase()) ||
    k.product_name?.toLowerCase().includes(keySearch.toLowerCase())
  );
  const filteredLicenses = licenses.filter(l =>
    !licSearch || l.key?.toLowerCase().includes(licSearch.toLowerCase()) ||
    l.username?.toLowerCase().includes(licSearch.toLowerCase()) ||
    l.product_name?.toLowerCase().includes(licSearch.toLowerCase())
  );

  //  tabs config 
  const TABS = [
    { id: 'stats',         label: 'Stats',         icon: ICONS.stats },
    { id: 'users',         label: 'Users',          icon: ICONS.users,  badge: null },
    { id: 'products',      label: 'Products',       icon: ICONS.products },
    { id: 'keys',          label: 'Keys',           icon: ICONS.keys },
    { id: 'payments',      label: 'Payments',       icon: ICONS.payments,  badge: pendingPayments.length },
    { id: 'licenses',      label: 'Licenses',       icon: ICONS.licenses },
    { id: 'hwid_requests', label: 'HWID Resets',    icon: ICONS.keys,      badge: hwidRequests.filter(r => r.status === 'pending').length },
    { id: 'notifications', label: 'Notify',         icon: ICONS.notify },
  ];

  //  loading screen 
  if (globalLoading) {
    return (
      <div className="page-loader" role="status">
        <div className="spinner" aria-hidden="true" />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading admin data...</span>
      </div>
    );
  }

  // 
  return (
    <div>
      <Toast toast={toast} />

      {/* page title */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Admin Panel</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            Devish Store management
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={fetchAll}
          aria-label="Refresh all data"
        >
           Refresh
        </button>
      </div>

      {/*  tab bar  */}
      <div className="tabs admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={`tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            style={{ position: 'relative' }}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
            {t.badge > 0 && (
              <span
                className="tab-badge"
                aria-label={`${t.badge} pending`}
              >{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/*  STATS  */}
      {activeTab === 'stats' && (
        <div>
          {errors.stats && <SectionError message={errors.stats} onRetry={fetchAll} />}
          <div className="grid-stats">
            <StatCard icon={ICONS.users} label="Total Users"      value={stats.totalUsers}    color="var(--brand-light)" />
            <StatCard icon={ICONS.revenue} label="Total Revenue"    value={stats.totalRevenue != null ? `$${Number(stats.totalRevenue).toFixed(2)}` : '...'} color="var(--success)" />
            <StatCard icon={ICONS.keys} label="Keys Sold"        value={stats.totalKeysSold} color="var(--info)" />
            <StatCard icon={ICONS.success} label="Active Licenses"  value={stats.activeLicenses} color="var(--warning)" />
            <StatCard icon={ICONS.products} label="Products"         value={stats.totalProducts} color="var(--brand-light)" />
            <StatCard icon={ICONS.keys} label="Pending HWID Resets" value={stats.pendingHwidResets || 0} color="var(--danger)" 
              sub={(stats.pendingHwidResets || 0) > 0 ? 'Action required' : undefined} 
            />
            <StatCard icon={ICONS.notify} label="Pending Payments" value={stats.pendingPayments} color="var(--danger)"
              sub={stats.pendingPayments > 0 ? 'Action required' : undefined}
            />
          </div>
        </div>
      )}

      {/*  USERS  */}
      {activeTab === 'users' && (
        <div>
          {errors.users && <SectionError message={errors.users} onRetry={fetchAll} />}

          {/* Create user */}
          <div className="card">
            <h2 className="section-title">Create New User</h2>
            <form onSubmit={handleCreateUser} noValidate>
              <div className="admin-form-grid-3">
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="nu-username">Username *</label>
                  <input
                    id="nu-username"
                    type="text"
                    className="input"
                    style={{ marginBottom: 0 }}
                    placeholder="3...32 characters"
                    maxLength={32}
                    value={newUser.username}
                    onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                    autoCapitalize="none"
                    spellCheck="false"
                    required
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="nu-pass">Password *</label>
                  <input
                    id="nu-pass"
                    type="password"
                    className="input"
                    style={{ marginBottom: 0 }}
                    placeholder="Min 6 characters"
                    maxLength={128}
                    value={newUser.password}
                    onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="nu-role">Role</label>
                  <select
                    id="nu-role"
                    className="select"
                    value={newUser.role}
                    onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}
                  >
                    <option value="user">User</option>
                    <option value="reseller">Reseller</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ marginTop: 14 }}
                disabled={actionLoading.createUser}
                aria-busy={actionLoading.createUser}
              >
                {actionLoading.createUser
                  ? <><span className="spinner spinner-sm" aria-hidden="true" /> Creating...</>
                  : 'Create User'
                }
              </button>
            </form>
          </div>

          {/* Credits manager */}
          <div className="card">
            <h2 className="section-title">Manage Credits</h2>
            <form onSubmit={handleUpdateCredits} noValidate>
              <div className="admin-form-grid-4">
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="cr-user">User</label>
                  <select
                    id="cr-user"
                    className="select"
                    value={creditForm.userId}
                    onChange={e => setCreditForm(f => ({ ...f, userId: e.target.value }))}
                    required
                  >
                    <option value="">Select user...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.username} (${Number(u.credits || 0).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="cr-amount">Amount ($)</label>
                  <div className="input-prefix-wrap">
                    <span className="input-prefix">$</span>
                    <input
                      id="cr-amount"
                      type="number"
                      step="0.01"
                      min="0"
                      className="input input-prefixed"
                      style={{ marginBottom: 0 }}
                      placeholder="0.00"
                      value={creditForm.amount}
                      onChange={e => setCreditForm(f => ({ ...f, amount: e.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="cr-op">Operation</label>
                  <select
                    id="cr-op"
                    className="select"
                    value={creditForm.operation}
                    onChange={e => setCreditForm(f => ({ ...f, operation: e.target.value }))}
                  >
                    <option value="add">Add credits</option>
                    <option value="remove">Remove credits</option>
                    <option value="set">Set exact amount</option>
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0, display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    type="submit"
                    className="btn btn-primary btn-block"
                    disabled={actionLoading.credits}
                    aria-busy={actionLoading.credits}
                  >
                    {actionLoading.credits ? <span className="spinner spinner-sm" aria-hidden="true" /> : 'Update'}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Users table */}
          <div className="card card-flush">
            <div className="card-list-header">
              <h2 className="section-title" style={{ margin: 0 }}>All Users</h2>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="search"
                  className="input"
                  style={{ width: 180, marginBottom: 0 }}
                  placeholder="Search username..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  aria-label="Search users"
                />
                <span className="badge badge-muted">{filteredUsers.length}</span>
              </div>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table" aria-label="Users table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Balance</th>
                    <th>Total Recharged</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id} className={u.is_banned ? 'row-expired' : ''}>
                      <td><strong style={{ color: u.is_banned ? 'var(--text-muted)' : 'var(--text-primary)' }}>{u.username}</strong></td>
                      <td>
                        <span className={`badge ${
                          u.role === 'admin'    ? 'badge-purple' :
                          u.role === 'reseller' ? 'badge-info'   : 'badge-muted'
                        }`}>{u.role}</span>
                      </td>
                      <td>
                        <strong style={{ color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>
                          ${Number(u.credits || 0).toFixed(2)}
                        </strong>
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        ${Number(u.total_recharged || 0).toFixed(2)}
                      </td>
                      <td>
                        <span className={`badge ${u.is_banned ? 'badge-danger' : 'badge-success'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          {u.is_banned 
                            ? <><span style={{ display: 'flex', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'currentColor' }} /> Banned</> 
                            : <><span style={{ display: 'flex', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'currentColor' }} /> Active</>}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => handleBanUser(u.id, u.is_banned, u.username)}
                            disabled={actionLoading.ban}
                            aria-label={`${u.is_banned ? 'Unban' : 'Ban'} ${u.username}`}
                          >
                            {u.is_banned ? 'Unban' : 'Ban'}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            disabled={actionLoading.deleteUser}
                            aria-label={`Delete ${u.username}`}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan="6">
                      <div className="empty-state"><p>{userSearch ? 'No users match your search' : 'No users yet'}</p></div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/*  PRODUCTS  */}
      {activeTab === 'products' && (
        <div>
          {errors.products && <SectionError message={errors.products} onRetry={fetchAll} />}

          {/* Create/Edit product form */}
          <div className="card">
            <h2 className="section-title">{editingProductId ? 'Edit Product' : 'Add New Product'}</h2>
            <form onSubmit={handleSaveProduct} noValidate>

              <div className="admin-form-grid-2" style={{ marginBottom: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="p-name">Product Name *</label>
                  <input
                    id="p-name"
                    type="text"
                    className="input"
                    style={{ marginBottom: 0 }}
                    placeholder="e.g. Premium Cheat v2"
                    maxLength={128}
                    value={newProduct.name}
                    onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="p-img">
                    Image URL
                    <span className="label-optional"> (optional)</span>
                  </label>
                  <input
                    id="p-img"
                    type="url"
                    className="input"
                    style={{ marginBottom: 0 }}
                    placeholder="https://i.imgur.com/... (leave blank for default icon)"
                    value={newProduct.image_url}
                    onChange={e => setNewProduct(p => ({ ...p, image_url: e.target.value }))}
                  />
                </div>
              </div>

              <div className="admin-form-grid-2" style={{ marginBottom: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="p-type">Key Type</label>
                  <select
                    id="p-type"
                    className="select"
                    value={newProduct.key_type}
                    onChange={e => setNewProduct(p => ({ ...p, key_type: e.target.value }))}
                  >
                    <option value="license_only">License Key</option>
                    <option value="username_password">Username + Password</option>
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="p-pattern">
                    Custom Key Pattern
                    <span className="label-optional"> (optional)</span>
                  </label>
                  <input
                    id="p-pattern"
                    type="text"
                    className="input"
                    style={{ marginBottom: 0 }}
                    placeholder="e.g. XXXX-XXXX-XXXX-XXXX"
                    value={newProduct.custom_key_pattern}
                    onChange={e => setNewProduct(p => ({ ...p, custom_key_pattern: e.target.value }))}
                  />
                </div>
              </div>

              {/* Pricing options */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label className="form-label" style={{ margin: 0 }}>
                    Pricing Options *
                    {newProduct.days_config.length > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                        ({newProduct.days_config.length} added)
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={addDayOption}
                  >
                    + Add Option
                  </button>
                </div>
                {newProduct.days_config.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '10px 0' }}>
                    No pricing options yet. Click "+ Add Option" to add at least one.
                  </p>
                ) : (
                  newProduct.days_config.map((c, i) => (
                    <DayRow
                      key={i}
                      config={c}
                      index={i}
                      onChange={updateDayOption}
                      onRemove={removeDayOption}
                    />
                  ))
                )}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading.saveProduct}
                  aria-busy={actionLoading.saveProduct}
                >
                  {actionLoading.saveProduct
                    ? <><span className="spinner spinner-sm" aria-hidden="true" /> {editingProductId ? 'Saving...' : 'Creating...'}</>
                    : (editingProductId ? 'Save Changes' : 'Create Product')
                  }
                </button>
                {editingProductId && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={cancelEditProduct}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Products list */}
          <div className="card card-flush">
            <div className="card-list-header">
              <h2 className="section-title" style={{ margin: 0 }}>All Products</h2>
              <span className="badge badge-muted">{products.length}</span>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table" aria-label="Products table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Image</th>
                    <th>Pricing Options</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td>
                        <span className="badge badge-muted" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {p.key_type === 'license_only' ? (
                            <><span style={{ width: 14, height: 14 }}>{ICONS.keys}</span> License</>
                          ) : (
                            <><span style={{ width: 14, height: 14 }}>{ICONS.userPass}</span> User/Pass</>
                          )}
                        </span>
                      </td>
                      <td>
                        {p.image_url
                          ? <img src={p.image_url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
                          : <span style={{ fontSize: 20 }}></span>
                        }
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {p.available_days?.map(d => (
                            <span key={d.id} className="badge badge-info" style={{ fontSize: 11 }}>
                              {d.days}d / ${d.price}
                            </span>
                          ))}
                          {!p.available_days?.length && (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>None</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => handleEditProductClick(p)}
                            aria-label={`Edit ${p.name}`}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDeleteProduct(p.id, p.name)}
                            disabled={actionLoading.deleteProduct}
                            aria-label={`Delete ${p.name}`}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr><td colSpan="5">
                      <div className="empty-state"><div className="empty-state-icon" style={{ width: 48, height: 48, margin: '0 auto', color: 'var(--text-muted)' }}>{ICONS.products}</div><p>No products yet</p></div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/*  KEYS  */}
      {activeTab === 'keys' && (
        <div>
          {errors.keys && <SectionError message={errors.keys} onRetry={fetchAll} />}

          {/* Upload form */}
          <div className="card">
            <h2 className="section-title">Upload License Keys</h2>
            <form onSubmit={handleUploadKeys} noValidate>
              <div className="admin-form-grid-2" style={{ marginBottom: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="ku-product">Product *</label>
                  <select
                    id="ku-product"
                    className="select"
                    value={keyUpload.product_id}
                    onChange={e => setKeyUpload(k => ({ ...k, product_id: e.target.value }))}
                    required
                  >
                    <option value="">Select product...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="ku-days">Duration *</label>
                  <select
                    id="ku-days"
                    className="select"
                    value={keyUpload.days}
                    onChange={e => setKeyUpload(k => ({ ...k, days: e.target.value }))}
                    required
                  >
                    <option value="">Select days...</option>
                    {[1, 3, 7, 15, 30, 60, 90, 180, 365].map(d => (
                      <option key={d} value={d}>{d} days</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ku-keys">
                  Keys ... one per line *
                  {keyUpload.keys && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                      ({keyUpload.keys.split('\n').filter(k => k.trim()).length} keys)
                    </span>
                  )}
                </label>
                <textarea
                  id="ku-keys"
                  className="textarea"
                  rows={7}
                  placeholder={"KEY-XXXX-XXXX-XXXX-1\nKEY-XXXX-XXXX-XXXX-2\nKEY-XXXX-XXXX-XXXX-3"}
                  value={keyUpload.keys}
                  onChange={e => setKeyUpload(k => ({ ...k, keys: e.target.value }))}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={actionLoading.uploadKeys}
                aria-busy={actionLoading.uploadKeys}
              >
                {actionLoading.uploadKeys
                  ? <><span className="spinner spinner-sm" aria-hidden="true" /> Uploading...</>
                  : 'Upload Keys'
                }
              </button>
            </form>
          </div>

          {/* Key pool table */}
          <div className="card card-flush">
            <div className="card-list-header">
              <h2 className="section-title" style={{ margin: 0 }}>Key Pool</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="badge badge-success">{keys.filter(k => !k.is_used).length} available</span>
                <span className="badge badge-danger">{keys.filter(k => k.is_used).length} used</span>
                <input
                  type="search"
                  className="input"
                  style={{ width: 160, marginBottom: 0 }}
                  placeholder="Search keys..."
                  value={keySearch}
                  onChange={e => setKeySearch(e.target.value)}
                  aria-label="Search keys"
                />
              </div>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table" aria-label="Keys table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Duration</th>
                    <th>Key Value</th>
                    <th>Status</th>
                    <th>Used By</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredKeys.slice(0, 200).map(k => (
                    <tr key={k.id} className={k.is_used ? 'row-expired' : ''}>
                      <td><strong>{k.product_name}</strong></td>
                      <td><span className="badge badge-muted">{k.days}d</span></td>
                      <td>
                        <code style={{ fontSize: 11 }}>{k.key_value}</code>
                      </td>
                      <td>
                        <span className={`badge ${k.is_used ? 'badge-danger' : 'badge-success'}`}>
                          {k.is_used ? ' Used' : ' Available'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {k.used_by || '...'}
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDeleteKey(k.id)}
                          disabled={actionLoading.deleteKey}
                          aria-label="Delete Key"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredKeys.length === 0 && (
                    <tr><td colSpan="6">
                      <div className="empty-state"><div className="empty-state-icon" style={{ width: 48, height: 48, margin: '0 auto', color: 'var(--text-muted)' }}>{ICONS.keys}</div><p>{keySearch ? 'No keys match your search' : 'No keys uploaded yet'}</p></div>
                    </td></tr>
                  )}
                </tbody>
              </table>
              {filteredKeys.length > 200 && (
                <p style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                  Showing first 200 of {filteredKeys.length} keys. Use search to filter.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/*  PAYMENTS  */}
      {activeTab === 'payments' && (
        <div>
          {errors.payments && <SectionError message={errors.payments} onRetry={fetchAll} />}

          {pendingPayments.length > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
               {pendingPayments.length} payment{pendingPayments.length > 1 ? 's' : ''} awaiting approval
            </div>
          )}

          <div className="card card-flush">
            <div className="card-list-header">
              <h2 className="section-title" style={{ margin: 0 }}>All Payments</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                {pendingPayments.length > 0 && (
                  <span className="badge badge-warning">{pendingPayments.length} pending</span>
                )}
                <span className="badge badge-muted">{payments.length} total</span>
              </div>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table" aria-label="Payments table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Transaction ID</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className={p.status === 'pending' ? 'row-pending' : ''}>
                      <td><strong>{p.username}</strong></td>
                      <td>
                        <strong style={{ color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>
                          ${p.amount}
                        </strong>
                      </td>
                      <td>
                        <code style={{ fontSize: 10.5 }}>
                          {p.tx_id
                            ? p.tx_id.slice(0, 24) + (p.tx_id.length > 24 ? '...' : '')
                            : '...'
                          }
                        </code>
                      </td>
                      <td>
                        <span className={`badge ${
                          p.status === 'completed' ? 'badge-success' :
                          p.status === 'pending'   ? 'badge-warning' : 'badge-danger'
                        }`}>{p.status}</span>
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(p.date).toLocaleString()}
                      </td>
                      <td>
                        {p.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => handleApprovePayment(p.id, p.amount, p.username)}
                              disabled={actionLoading.approve}
                              aria-label={`Approve $${p.amount} for ${p.username}`}
                            >
                              {actionLoading.approve
                                ? <span className="spinner spinner-sm" aria-hidden="true" />
                                : 'Approve'
                              }
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => handleRejectPayment(p.id, p.amount, p.username)}
                              disabled={actionLoading.reject}
                              aria-label={`Reject $${p.amount} for ${p.username}`}
                            >
                              {actionLoading.reject
                                ? <span className="spinner spinner-sm" aria-hidden="true" />
                                : 'Reject'
                              }
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>...</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr><td colSpan="6">
                      <div className="empty-state"><div className="empty-state-icon" style={{ width: 48, height: 48, margin: '0 auto', color: 'var(--text-muted)' }}>{ICONS.payments}</div><p>No payments yet</p></div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/*  LICENSES  */}
      {activeTab === 'licenses' && (
        <div>
          {errors.licenses && <SectionError message={errors.licenses} onRetry={fetchAll} />}

          <div className="card card-flush">
            <div className="card-list-header">
              <h2 className="section-title" style={{ margin: 0 }}>All Licenses</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="search"
                  className="input"
                  style={{ width: 180, marginBottom: 0 }}
                  placeholder="Search..."
                  value={licSearch}
                  onChange={e => setLicSearch(e.target.value)}
                  aria-label="Search licenses"
                />
                <span className="badge badge-muted">{filteredLicenses.length}</span>
              </div>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table" aria-label="Licenses table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Product</th>
                    <th>Key</th>
                    <th>Duration</th>
                    <th>Expiry</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLicenses.slice(0, 200).map(l => {
                    const active = new Date(l.expiry_date) > now;
                    return (
                      <tr key={l.id} className={!active ? 'row-expired' : ''}>
                        <td><strong>{l.username}</strong></td>
                        <td>{l.product_name}</td>
                        <td><code style={{ fontSize: 10.5 }}>{l.key}</code></td>
                        <td><span className="badge badge-muted">{l.days}d</span></td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                          {new Date(l.expiry_date).toLocaleDateString()}
                        </td>
                        <td>
                          <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
                            {active ? ' Active' : ' Expired'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredLicenses.length === 0 && (
                    <tr><td colSpan="6">
                      <div className="empty-state"><div className="empty-state-icon" style={{ width: 48, height: 48, margin: '0 auto', color: 'var(--text-muted)' }}>{ICONS.licenses}</div><p>{licSearch ? 'No results' : 'No licenses yet'}</p></div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/*  HWID REQUESTS  */}
      {activeTab === 'hwid_requests' && (
        <div>
          {errors.hwid && <SectionError message={errors.hwid} onRetry={fetchAll} />}

          <div className="card card-flush">
            <div className="card-list-header">
              <h2 className="section-title" style={{ margin: 0 }}>HWID Reset Requests</h2>
              <span className="badge badge-muted">{hwidRequests.length}</span>
            </div>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>License Key</th>
                    <th>Username</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hwidRequests.length === 0 ? (
                    <tr>
                      <td colSpan="5">
                        <div className="empty-state">
                          <p>No HWID reset requests.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    hwidRequests.map(r => (
                      <tr key={r.id}>
                        <td>
                          <code style={{ fontSize: 11, background: 'var(--bg-inset)', padding: '4px 8px', borderRadius: '4px' }}>
                            {r.license_key}
                          </code>
                        </td>
                        <td>{r.username}</td>
                        <td>
                          <span className={`badge ${r.status === 'pending' ? 'badge-warning' : r.status === 'completed' ? 'badge-success' : 'badge-danger'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'flex', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'currentColor' }} /> {r.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{new Date(r.created_at).toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>
                          {r.status === 'pending' && (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => handleApproveHwid(r.id)}
                                disabled={busy['hwid']}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => handleRejectHwid(r.id)}
                                disabled={busy['hwid']}
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/*  NOTIFICATIONS  */}
      {activeTab === 'notifications' && (
        <div style={{ maxWidth: 600 }}>
          <div className="card">
            <h2 className="section-title">Send Notification</h2>
            <form onSubmit={handleSendNotif} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="notif-title">Title *</label>
                <input
                  id="notif-title"
                  type="text"
                  className="input"
                  placeholder="Notification title"
                  maxLength={120}
                  value={notifForm.title}
                  onChange={e => setNotifForm(f => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="notif-msg">Message *</label>
                <textarea
                  id="notif-msg"
                  className="textarea"
                  rows={4}
                  placeholder="Write your notification message here..."
                  maxLength={500}
                  value={notifForm.message}
                  onChange={e => setNotifForm(f => ({ ...f, message: e.target.value }))}
                  required
                  style={{ fontFamily: 'inherit', fontSize: 14 }}
                />
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  {notifForm.message.length}/500
                </p>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="notif-target">Send To</label>
                <select
                  id="notif-target"
                  className="select"
                  value={notifForm.is_global ? 'global' : 'specific'}
                  onChange={e => setNotifForm(f => ({
                    ...f,
                    is_global: e.target.value === 'global',
                    target_user: '',
                  }))}
                >
                  <option value="global"> All users (broadcast)</option>
                  <option value="specific"> Specific user</option>
                </select>
              </div>
              {!notifForm.is_global && (
                <div className="form-group">
                  <label className="form-label" htmlFor="notif-user">Select User *</label>
                  <select
                    id="notif-user"
                    className="select"
                    value={notifForm.target_user}
                    onChange={e => setNotifForm(f => ({ ...f, target_user: e.target.value }))}
                    required
                  >
                    <option value="">Choose a user...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.username}>{u.username}</option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={actionLoading.notif}
                aria-busy={actionLoading.notif}
              >
                {actionLoading.notif
                  ? <><span className="spinner spinner-sm" aria-hidden="true" /> Sending...</>
                  : `Send to ${notifForm.is_global ? 'all users' : 'user'}`
                }
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
