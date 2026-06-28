import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, api } from '../context/AuthContext';

function ConfirmModal({ product, dayOption, userCredits, onConfirm, onCancel, loading }) {
  const canAfford = userCredits >= dayOption.price;
  const remaining = userCredits - dayOption.price;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal">
        <h2 id="confirm-title" style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 16 }}>Confirm Purchase</h2>
        <div className="purchase-summary">
          <div className="info-row">
            <span className="info-row-label">Product</span>
            <span className="info-row-value">{product.name}</span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Duration</span>
            <span className="info-row-value">{dayOption.days} days</span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Price</span>
            <span className="info-row-value" style={{ color: 'var(--warning)', fontWeight: 700 }}>
              ${dayOption.price.toFixed(2)}
            </span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Your balance</span>
            <span className="info-row-value">${userCredits.toFixed(2)}</span>
          </div>
          {canAfford && (
            <div className="info-row">
              <span className="info-row-label">After purchase</span>
              <span className="info-row-value" style={{ color: 'var(--success)' }}>
                ${remaining.toFixed(2)}
              </span>
            </div>
          )}
        </div>
        {!canAfford && (
          <div className="alert alert-danger" style={{ marginTop: 14 }}>
            ⚠️ Insufficient balance. <Link to="/payments" style={{ color: 'var(--danger)', fontWeight: 700 }}>Add credits</Link>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onCancel} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={onConfirm}
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={!canAfford || loading}
            aria-busy={loading}
          >
            {loading ? <><span className="spinner spinner-sm" aria-hidden="true" /> Processing…</> : 'Confirm Purchase'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Products() {
  const { user, refreshUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get('/api/products');
      setProducts(res.data);
    } catch { showToast('Failed to load products.', 'danger'); }
    finally { setPageLoading(false); }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const handleBuy = async () => {
    if (!selected || !selectedDay) return;
    setLoading(true);
    try {
      const res = await api.post('/api/licenses/buy', {
        product_id: selected.id,
        days: selectedDay.days,
      });
      setShowModal(false);
      setSelected(null);
      setSelectedDay(null);
      refreshUser();
      fetchProducts();
      showToast(`License purchased! Key: ${res.data.license}`, 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Purchase failed.', 'danger');
      setShowModal(false);
    } finally {
      setLoading(false);
    }
  };

  if (pageLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" aria-label="Loading products" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Products</h1>

      {toast && (
        <div className={`alert alert-${toast.type}`} role="alert" aria-live="polite" style={{ maxWidth: 600 }}>
          {toast.type === 'success' ? '✅' : '⚠️'} {toast.msg}
        </div>
      )}

      {/* Product grid */}
      {!selected && (
        <>
          {products.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">📦</div>
                <strong style={{ color: 'var(--text-secondary)' }}>No products available</strong>
                <p>Check back soon for new products.</p>
              </div>
            </div>
          ) : (
            <div className="grid">
              {products.map(p => (
                <div
                  key={p.id}
                  className="product-card"
                  onClick={() => { setSelected(p); setSelectedDay(null); }}
                  role="button"
                  tabIndex={0}
                  aria-label={`View ${p.name}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setSelected(p); setSelectedDay(null); } }}
                >
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="product-card-img" loading="lazy" />
                  ) : (
                    <div className="product-card-img-placeholder" aria-hidden="true">📦</div>
                  )}
                  <div className="product-card-body">
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{p.name}</h3>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                      {p.key_type === 'license_only' ? 'License Key' : 'Username + Password'}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {p.available_days?.map(d => (
                        <span key={d.id} className="badge badge-success">{d.days}d — ${d.price}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Product detail */}
      {selected && (
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setSelected(null); setSelectedDay(null); }}
            style={{ marginBottom: 20 }}
          >
            ← Back to Products
          </button>

          <div className="card">
            {selected.image_url ? (
              <img
                src={selected.image_url}
                alt={selected.name}
                style={{ width: '100%', height: 240, objectFit: 'cover', borderRadius: 'var(--r-md)', marginBottom: 24 }}
                loading="lazy"
              />
            ) : (
              <div style={{
                width: '100%', height: 180, background: 'var(--bg-elevated)', borderRadius: 'var(--r-md)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, marginBottom: 24
              }}>📦</div>
            )}
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>{selected.name}</h2>
            <p style={{ fontSize: 13, marginTop: 6, marginBottom: 24 }}>
              Type: <span className="badge badge-muted">{selected.key_type === 'license_only' ? 'License Key' : 'Username + Password'}</span>
            </p>

            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
              Select Duration
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
              {selected.available_days?.map(d => (
                <button
                  key={d.id}
                  className={`day-btn ${selectedDay?.id === d.id ? 'selected' : ''}`}
                  onClick={() => setSelectedDay(d)}
                  aria-pressed={selectedDay?.id === d.id}
                >
                  <div className="day-count">{d.days} days</div>
                  <div className="day-price">${d.price}</div>
                </button>
              ))}
            </div>

            {selectedDay && (
              <div className="purchase-summary" style={{ marginBottom: 20 }}>
                <div className="info-row">
                  <span className="info-row-label">Price</span>
                  <span className="info-row-value" style={{ color: 'var(--warning)' }}>${selectedDay.price.toFixed(2)}</span>
                </div>
                <div className="info-row">
                  <span className="info-row-label">Your balance</span>
                  <span className="info-row-value">${user?.credits?.toFixed(2)}</span>
                </div>
              </div>
            )}

            {user?.credits < selectedDay?.price && selectedDay && (
              <div className="alert alert-warning">
                ⚠️ Insufficient balance.{' '}
                <Link to="/payments" style={{ color: 'var(--warning)', fontWeight: 700 }}>Add credits →</Link>
              </div>
            )}

            <button
              className="btn btn-primary btn-lg btn-block"
              onClick={() => setShowModal(true)}
              disabled={!selectedDay || user?.credits < selectedDay?.price}
              aria-label={selectedDay ? `Buy ${selected.name} for ${selectedDay.days} days` : 'Select a duration first'}
            >
              {selectedDay ? `Buy for $${selectedDay.price}` : 'Select a Duration'}
            </button>
          </div>
        </div>
      )}

      {showModal && selected && selectedDay && (
        <ConfirmModal
          product={selected}
          dayOption={selectedDay}
          userCredits={user?.credits ?? 0}
          onConfirm={handleBuy}
          onCancel={() => setShowModal(false)}
          loading={loading}
        />
      )}
    </div>
  );
}
