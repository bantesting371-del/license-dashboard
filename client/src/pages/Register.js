import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setSuccess('');
    try {
      await axios.post('/api/auth/signup', { username, password });
      setSuccess('Registration successful! Redirecting to login...');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '420px', margin: '80px auto', padding: '0 16px' }}>
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: '28px', fontWeight: '800', color: '#fff', letterSpacing: '-0.02em' }}>Create Account</h2>
          <p style={{ color: '#a1a1aa', marginTop: '8px' }}>Join us to get your licenses</p>
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#e4e4e7', fontSize: '14px', fontWeight: '600' }}>Username</label>
            <input type="text" placeholder="Choose a username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#e4e4e7', fontSize: '14px', fontWeight: '600' }}>Password</label>
            <input type="password" placeholder="Choose a secure password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '14px', fontSize: '16px', fontWeight: '700' }} disabled={loading}>
             {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <div style={{ marginTop: '32px', textAlign: 'center', fontSize: '14px', color: '#a1a1aa', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '24px' }}>
          Already have an account? <Link to="/login" style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: '600', marginLeft: '6px' }}>Sign In</Link>
        </div>
      </div>
    </div>
  );
}
