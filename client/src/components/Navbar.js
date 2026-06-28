import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <Link to="/" style={{ color: 'white', textDecoration: 'none', fontSize: '20px', fontWeight: 'bold' }}>
        🔐 License Dashboard
      </Link>
      <div className="nav-links">
        {user ? (
          <>
            <Link to="/">Dashboard</Link>
            <Link to="/products">Products</Link>
            <Link to="/licenses">Licenses</Link>
            <Link to="/payments">Payments</Link>
            {user.role === 'admin' && <Link to="/admin" style={{color:'#fbbf24'}}>Admin</Link>}
            <span style={{ color: '#34d399', marginLeft: '15px', fontWeight: 'bold' }}>
              ${user.credits?.toFixed(2)}
            </span>
            <button onClick={handleLogout} className="btn btn-danger" style={{ marginLeft: '15px', padding: '6px 14px', fontSize: '13px' }}>
              Logout
            </button>
          </>
        ) : (
          <Link to="/login">Login</Link>
        )}
      </div>
    </nav>
  );
}
