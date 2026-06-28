import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [logoUrl, setLogoUrl] = useState('');

  useEffect(() => {
    axios.get('/api/config').then(res => setLogoUrl(res.data.logoUrl)).catch(console.error);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        {logoUrl ? <img src={logoUrl} alt="Logo" /> : <span>🔐</span>} 
        License Dashboard
      </Link>
      <div className="nav-links">
        {user ? (
          <>
            <Link to="/">Dashboard</Link>
            <Link to="/products">Products</Link>
            <Link to="/licenses">Licenses</Link>
            <Link to="/payments">Payments</Link>
            {user.role === 'admin' && <Link to="/admin" style={{color:'#fbbf24'}}>Admin</Link>}
            <span style={{ color: '#34d399', marginLeft: '10px', fontWeight: 'bold', background: 'rgba(52, 211, 153, 0.1)', padding: '6px 12px', borderRadius: '20px', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
              ${user.credits?.toFixed(2)}
            </span>
            <button onClick={handleLogout} className="btn btn-danger" style={{ padding: '6px 14px', fontSize: '13px' }}>
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="btn" style={{ background: 'transparent', border: '1px solid #334155', color: '#fff' }}>Login</Link>
            <Link to="/register" className="btn btn-primary">Register</Link>
          </>
        )}
      </div>
    </nav>
  );
}
