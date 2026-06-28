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
  if (loading) return <div style={{textAlign:'center',padding:'50px',color:'#94a3b8'}}>Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (requireAdmin && user.role !== 'admin') return <Navigate to="/" />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <div className="container">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
            <Route path="/licenses" element={<ProtectedRoute><Licenses /></ProtectedRoute>} />
            <Route path="/payments" element={<ProtectedRoute><Payments /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
          </Routes>
        </div>
        <div style={{ textAlign: 'center', padding: '30px 20px', marginTop: '40px', borderTop: '1px solid #334155', color: '#64748b' }}>
          <p style={{ marginBottom: '10px' }}>Need help?</p>
          <a href="https://www.facebook.com/profile.php?id=61575526575443" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', marginRight: '15px', textDecoration: 'none' }}>📘 Facebook Support</a>
          <a href="https://wa.me/qr/27BNHG7PCBF6L1" target="_blank" rel="noopener noreferrer" style={{ color: '#10b981', textDecoration: 'none' }}>💬 WhatsApp Support</a>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
