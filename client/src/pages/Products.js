import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, api } from '../context/AuthContext';

// ─── Products page ────────────────────────────────────────────────────────────
// Grid of product cards → detail view → confirm modal → success screen.
// Image is optional: graceful placeholder shown when absent.
// After purchase the full formatted key block is shown:
//   Key: <LICENSE_KEY>
// Users can copy it directly from the success screen.
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div className={`toast toast-${type}`} role="alert" aria-live="polite">
      <span>{type === 'success' ? '✅' : '⚠️'}</span>
      <span>{msg}</span>
    </div>
  );
}

/* Confirm modal — shows before deducting credits */
function ConfirmModal({ product, dayOption, userCredits, onConfirm, onCancel, loading }) {
  const canAfford = userCredits >= dayOption.price;
  const remaining = userCredits - dayOption.price;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal">
        <div className="modal-header">
          <h2 id="confirm-title" className="modal-title">Confirm Purchase</h2>
          <button
            className="modal-close"
            onClick={onCancel}
            aria-label="Cancel purchase"
          >✕</button>
        </div>

        <div className="purchase-summary">
          {[
            { label: 'Product',       value: product.name },
            { label: 'Duration',      value: `${dayOption.days} days` },
            { label: 'Price',         value: `$${dayOption.price.toFixed(2)}`, accent: 'var(--warning)' },
            { label: 'Your balance',  value: `$${userCredits.toFixed(2)}` },
            canAfford
              ? { label: 'After purchase', value: `$${remaining.toFixed(2)}`, accent: 'var(--success)' }
              : null,
          ].filter(Boolean).map(row => (
            <div className="info-row" key={row.label}>
              <span className="info-row-label">{row.label}</span>
              <span className="info-row-value" style={row.accent ? { color: row.accent, fontWeight: 700 } : {}}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {!canAfford && (
          <div className="alert alert-danger" style={{ marginTop: 14 }}>
            ⚠️ Insufficient balance.{' '}
            <Link to="/payments" style={{ color: 'var(--danger)', fontWeight: 700 }}>
              Add credits →
            </Link>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onCancel}  className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={onConfirm}
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={!canAfford || loading}
            aria-busy={loading}
          >
            {loading
              ? <><span className="spinner spinner-sm" aria-hidden="true" /> Processing…</>
              : 'Confirm Purchase'
            }
          </button>
        </div>
      </div>
    </div>
  );
}

/* Success screen shown after purchase */
function SuccessScreen({ license, expiry, productName, onClose }) {
  const [copied, setCopied] = useState(false);
  const keyText = `Key: ${license}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(keyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* silent */ }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="success-title"
    >
      <div className="modal success-modal">
        <div className="success-checkmark" aria-hidden="true">✅</div>
        <h2 id="success-title" className="success-title">Purchase Successful!</h2>
        <p className="success-sub">
          Your <strong>{productName}</strong> license is ready.
        </p>

        {/* key display */}
        <div className="key-reveal" aria-label={keyText}>
          <span className="key-reveal-label">Your License Key</span>
          <div className="key-reveal-box">
            <code className="key-reveal-value">{keyText}</code>
            <button
              className={`copy-btn ${copied ? 'copy-btn-done' : ''}`}
              onClick={handleCopy}
              aria-label={copied ? 'Copied!' : 'Copy license key'}
            >
              {copied ? '✅ Copied!' : '📋 Copy'}
            </button>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
          Expires: {new Date(expiry).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
            Buy More
          </button>
          <Link to="/licenses" className="btn btn-primary" style={{ flex: 1, textDecoration: 'none' }}>
            View Licenses →
          </Link>
        </div>
      </div>
    </div>
  );
}

/* Single product card in the grid */
function ProductCard({ product, onClick }) {
  const minPrice = product.available_days?.length
    ? Math.min(...product.available_days.map(d => d.price))
    : null;

  return (
    <div
      className="product-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`View ${product.name}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={product.name}
          className="product-card-img"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
        />
      ) : null}

      {/* placeholder — always in DOM, hidden when image loads */}
      <div
        className="product-card-img-placeholder"
        aria-hidden="true"
        style={{ display: product.image_url ? 'none' : 'flex' }}
      >
        📦
      </div>

      <div className="product-card-body">
        <h3 className="product-card-name">{product.name}</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
          <span className="badge badge-muted" style={{ fontSize: 11 }}>
            {product.key_type === 'license_only' ? '🔑 License' : '👤 User/Pass'}
          </span>
          {minPrice !== null && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--success)' }}>
              from ${minPrice}
            </span>
          )}
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {product.available_days?.map(d => (
            <span key={d.id} className="badge badge-info" style={{ fontSize: 11 }}>
              {d.days}d
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────
export default function Products() {
  const { user, refreshUser } = useAuth();
  const [products,     setProducts]     = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [selectedDay,  setSelectedDay]  = useState(null);
  const [showModal,    setShowModal]    = useState(false);
  const [success,      setSuccess]      = useState(null);   // { license, expiry, productName }
  const [loading,      setLoading]      = useState(false);
  const [pageLoading,  setPageLoading]  = useState(true);
  const [toast,        setToast]        = useState({ msg: '', type: 'success' });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type }), 5000);
  };

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get('/api/products');
      setProducts(res.data);
    } catch {
      showToast('Failed to load products.', 'danger');
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const handleBuy = async () => {
    if (!selected || !selectedDay) return;
    setLoading(true);
    try {
      const res = await api.post('/api/licenses/buy', {
        product_id: selected.id,
        days:       selectedDay.days,
      });
      setShowModal(false);
      setSuccess({
        license:     res.data.license,
        expiry:      res.data.expiry,
        productName: selected.name,
      });
      setSelected(null);
      setSelectedDay(null);
      refreshUser();
      fetchProducts();
    } catch (err) {
      setShowModal(false);
      showToast(err.response?.data?.error || 'Purchase failed. Please try again.', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => { setSelected(null); setSelectedDay(null); };

  if (pageLoading) {
    return (
      <div className="page-loader" role="status">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div>
      <Toast msg={toast.msg} type={toast.type} />

      {/* success overlay */}
      {success && (
        <SuccessScreen
          license={success.license}
          expiry={success.expiry}
          productName={success.productName}
          onClose={() => setSuccess(null)}
        />
      )}

      {/* confirm modal */}
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

      {/* ── product grid ── */}
      {!selected && (
        <>
          <div className="page-header">
            <h1 className="page-title" style={{ margin: 0 }}>Products</h1>
            <span className="badge badge-muted">{products.length} available</span>
          </div>

          {products.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">📦</div>
                <strong style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  No products yet
                </strong>
                <p>Check back soon — new products are coming.</p>
              </div>
            </div>
          ) : (
            <div className="grid">
              {products.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onClick={() => { setSelected(p); setSelectedDay(null); }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── product detail ── */}
      {selected && (
        <div style={{ maxWidth: 660, margin: '0 auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={goBack} style={{ marginBottom: 20 }}>
            ← Back
          </button>

          <div className="card">
            {/* image — optional */}
            {selected.image_url && (
              <img
                src={selected.image_url}
                alt={selected.name}
                style={{
                  width: '100%', height: 220, objectFit: 'cover',
                  borderRadius: 'var(--r-md)', marginBottom: 24, display: 'block',
                }}
                loading="lazy"
              />
            )}

            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
              {selected.name}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 24 }}>
              {selected.key_type === 'license_only' ? '🔑 License Key product' : '👤 Username + Password product'}
            </p>

            <h3 style={{
              fontSize: '0.78rem', fontWeight: 700,
              color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: '0.07em', marginBottom: 14,
            }}>
              Choose Duration
            </h3>

            {selected.available_days?.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                No pricing options configured yet.
              </p>
            )}

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

            {/* summary when day selected */}
            {selectedDay && (
              <div className="purchase-summary" style={{ marginBottom: 20 }}>
                <div className="info-row">
                  <span className="info-row-label">Price</span>
                  <span className="info-row-value" style={{ color: 'var(--warning)', fontWeight: 700 }}>
                    ${selectedDay.price.toFixed(2)}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-row-label">Your balance</span>
                  <span className="info-row-value">${(user?.credits ?? 0).toFixed(2)}</span>
                </div>
                <div className="info-row">
                  <span className="info-row-label">After purchase</span>
                  <span
                    className="info-row-value"
                    style={{
                      color: (user?.credits ?? 0) >= selectedDay.price
                        ? 'var(--success)'
                        : 'var(--danger)',
                    }}
                  >
                    ${((user?.credits ?? 0) - selectedDay.price).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* insufficient balance warning */}
            {selectedDay && (user?.credits ?? 0) < selectedDay.price && (
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                ⚠️ Not enough balance.{' '}
                <Link to="/payments" style={{ color: 'var(--warning)', fontWeight: 700 }}>
                  Add credits →
                </Link>
              </div>
            )}

            <button
              className="btn btn-primary btn-lg btn-block"
              onClick={() => setShowModal(true)}
              disabled={
                !selectedDay ||
                loading ||
                (user?.credits ?? 0) < (selectedDay?.price ?? 0)
              }
              aria-label={
                selectedDay
                  ? `Purchase ${selected.name} for ${selectedDay.days} days — $${selectedDay.price}`
                  : 'Select a duration first'
              }
            >
              {selectedDay
                ? `Buy for $${selectedDay.price}`
                : 'Select a Duration'
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
