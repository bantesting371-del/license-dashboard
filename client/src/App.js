import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import AdminDashboard from './pages/AdminDashboard';
import Products from './pages/Products';
import Licenses from './pages/Licenses';
import Payments from './pages/Payments';

function ProtectedRoute({ children, requireAdmin }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="loading-screen" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (requireAdmin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <main className="container">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
            <Route path="/licenses" element={<ProtectedRoute><Licenses /></ProtectedRoute>} />
            <Route path="/payments" element={<ProtectedRoute><Payments /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="footer">
          <span style={{ color: 'var(--text-muted)', fontSize: '12.5px' }}>Need support?</span>
          <a
            href="https://www.facebook.com/profile.php?id=61575526575443"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
            aria-label="Facebook support page (opens in new tab)"
          >
            <span aria-hidden="true">📘</span> Facebook
          </a>
          <a
            href="https://wa.me/qr/27BNHG7PCBF6L1"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
            aria-label="WhatsApp support chat (opens in new tab)"
          >
            <span aria-hidden="true">💬</span> WhatsApp
          </a>
        </footer>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
