require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// ==================== SECURITY HEADERS ====================
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'"
  );
  next();
});

// CORS — restrict in production via ALLOWED_ORIGIN env var
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || true,
  credentials: false,
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '512kb' }));

// ==================== RATE LIMITING ====================
const rateMap = new Map();
setInterval(() => rateMap.clear(), 60000); // GC every minute

const rateLimit = (maxReqs, windowMs) => (req, res, next) => {
  const key = (req.ip || 'unknown') + ':' + req.path;
  const now = Date.now();
  const entry = rateMap.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 1; entry.start = now; }
  else entry.count++;
  rateMap.set(key, entry);
  if (entry.count > maxReqs) {
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
  }
  next();
};

// ==================== DATABASE ====================
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDatabase() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        credits REAL DEFAULT 0,
        total_recharged REAL DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_url TEXT,
        key_type TEXT NOT NULL,
        custom_key_pattern TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS product_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        days INTEGER NOT NULL,
        price REAL NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS key_pool (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        days INTEGER NOT NULL,
        key_value TEXT NOT NULL,
        is_used INTEGER DEFAULT 0,
        used_by TEXT,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        username TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        days INTEGER NOT NULL,
        product_name TEXT,
        total_credits REAL,
        expiry_date DATETIME,
        status TEXT DEFAULT 'active',
        hwid TEXT,
        last_reset DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS hwid_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        license_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        FOREIGN KEY (license_id) REFERENCES licenses(id)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        payment_method TEXT DEFAULT 'binance',
        order_id TEXT,
        tx_id TEXT UNIQUE,
        amount REAL NOT NULL,
        credits_added REAL,
        status TEXT DEFAULT 'pending',
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_date DATETIME,
        approved_by TEXT
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS key_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        target_user TEXT,
        is_global INTEGER DEFAULT 0,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_by TEXT DEFAULT '[]'
      )
    `);

    // ---- Safe migrations for existing databases ----
    // Each ALTER TABLE is wrapped individually so one failure never blocks the rest.
    // LibSQL (Turso) throws if a column already exists — we catch and ignore those.
    const migrations = [
      `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`,
      `ALTER TABLE users ADD COLUMN credits REAL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN total_recharged REAL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
      `ALTER TABLE products ADD COLUMN image_url TEXT`,
      `ALTER TABLE products ADD COLUMN custom_key_pattern TEXT`,
      `ALTER TABLE products ADD COLUMN is_active INTEGER DEFAULT 1`,
      `ALTER TABLE products ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
      `ALTER TABLE key_pool ADD COLUMN used_by TEXT`,
      `ALTER TABLE key_pool ADD COLUMN used_at DATETIME`,
      `ALTER TABLE key_pool ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
      `ALTER TABLE licenses ADD COLUMN product_name TEXT`,
      `ALTER TABLE licenses ADD COLUMN total_credits REAL`,
      `ALTER TABLE licenses ADD COLUMN hwid TEXT`,
      `ALTER TABLE licenses ADD COLUMN last_reset DATETIME`,
      `ALTER TABLE licenses ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
      `ALTER TABLE payments ADD COLUMN payment_method TEXT DEFAULT 'binance'`,
      `ALTER TABLE payments ADD COLUMN tx_id TEXT`,
      `ALTER TABLE payments ADD COLUMN credits_added REAL`,
      `ALTER TABLE payments ADD COLUMN approved_date DATETIME`,
      `ALTER TABLE payments ADD COLUMN approved_by TEXT`,
      `ALTER TABLE notifications ADD COLUMN target_user TEXT`,
      `ALTER TABLE notifications ADD COLUMN created_by TEXT`,
      `ALTER TABLE notifications ADD COLUMN read_by TEXT DEFAULT '[]'`,
    ];
    for (const sql of migrations) {
      try { await db.execute(sql); }
      catch (e) {
        // "duplicate column" errors are expected and safe to ignore
        if (!e.message?.includes('duplicate column') && !e.message?.includes('already exists')) {
          console.warn('Migration skipped:', e.message?.slice(0, 80));
        }
      }
    }

    const kt = await db.execute('SELECT * FROM key_types');
    if (kt.rows.length === 0) {
      await db.execute(`
        INSERT INTO key_types (name, description) VALUES 
        ('license_only', 'Single license key (any digits)'),
        ('username_password', 'Username and Password type key')
      `);
    }

    // Provision Admin User via Environment Variables
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

    if (ADMIN_USERNAME && ADMIN_PASSWORD) {
      const existing = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [ADMIN_USERNAME] });
      const hashed = await bcrypt.hash(ADMIN_PASSWORD, 12);
      
      if (existing.rows.length === 0) {
        await db.execute({
          sql: 'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
          args: [ADMIN_USERNAME, hashed, 'admin']
        });
        console.log(`✅ Admin user '${ADMIN_USERNAME}' created from environment variables`);
      } else {
        await db.execute({
          sql: 'UPDATE users SET password = ?, role = ? WHERE username = ?',
          args: [hashed, 'admin', ADMIN_USERNAME]
        });
        console.log(`✅ Admin user '${ADMIN_USERNAME}' credentials updated from environment variables`);
      }
    }

    console.log('✅ Database initialized');
  } catch (error) {
    console.error('DB Init Error:', error);
  }
}

initDatabase();

// ==================== MIDDLEWARE ====================
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

async function fetchBinanceDepositAddress() {
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_SECRET_KEY) {
    if (process.env.BINANCE_DEPOSIT_ADDRESS) return process.env.BINANCE_DEPOSIT_ADDRESS;
    throw new Error('Payment gateway configuration error. Admin must set Binance API keys.');
  }

  const timestamp = Date.now();
  const queryString = `coin=USDT&network=BSC&recvWindow=60000&timestamp=${timestamp}`;
  const signature = crypto
    .createHmac('sha256', process.env.BINANCE_SECRET_KEY)
    .update(queryString)
    .digest('hex');

  try {
    const { data } = await axios.get(
      `https://api.binance.com/sapi/v1/capital/deposit/address?${queryString}&signature=${signature}`,
      {
        headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY },
        timeout: 15000
      }
    );

    if (!data.address) {
      if (process.env.BINANCE_DEPOSIT_ADDRESS) return process.env.BINANCE_DEPOSIT_ADDRESS;
      throw new Error('Could not fetch deposit address from Binance API');
    }

    return data.address;
  } catch (error) {
    if (process.env.BINANCE_DEPOSIT_ADDRESS) return process.env.BINANCE_DEPOSIT_ADDRESS;
    if (error.response && error.response.data) {
      throw new Error(`Binance API Error: ${error.response.data.msg || JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// ==================== BINANCE API VERIFICATION ====================
async function verifyBinanceDeposit(txId, expectedAmount) {
  try {
    if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_SECRET_KEY) {
      console.error('Binance API keys are missing in environment variables.');
      return { valid: false, message: 'Payment gateway configuration error. Admin must set Binance API keys.' };
    }

    const timestamp = Date.now();
    const queryString = `coin=USDT&recvWindow=60000&timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', process.env.BINANCE_SECRET_KEY)
      .update(queryString)
      .digest('hex');

    let data;
    try {
      const response = await axios.get(
        `https://api.binance.com/sapi/v1/capital/deposit/hisrec?${queryString}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY },
          timeout: 15000
        }
      );
      data = response.data;
    } catch (error) {
      if (error.response && error.response.data) {
        return { valid: false, message: `Binance API Error: ${error.response.data.msg || JSON.stringify(error.response.data)}` };
      }
      throw error;
    }

    const deposit = data.find(d => d.txId === txId);
    if (!deposit) {
      return { valid: false, message: 'Transaction not found in Binance deposit history. Please wait a few minutes and try again.' };
    }
    if (deposit.status !== 1) {
      return { valid: false, message: 'Transaction pending. Please wait for network confirmation.' };
    }
    if (parseFloat(deposit.amount) < parseFloat(expectedAmount)) {
      return { valid: false, message: `Amount mismatch. Expected $${expectedAmount}, found $${deposit.amount}` };
    }
    
    return { valid: true, amount: deposit.amount, status: deposit.status };
  } catch (error) {
    console.error('Binance API Error:', error.response?.data || error.message);
    return { valid: false, message: error.response?.data?.msg || 'Binance API error. Please try again later.' };
  }
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/signup', rateLimit(5, 60000), async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const u = String(username).trim().slice(0, 64);
    const p = String(password).slice(0, 128);

    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(u)) {
      return res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, _ or -)' });
    }
    if (p.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [u] });
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already exists' });

    const hashed = await bcrypt.hash(p, 12);
    await db.execute({
      sql: 'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      args: [u, hashed, 'user']
    });

    res.json({ message: 'User created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/register', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const u = String(username).trim().slice(0, 64);
    const p = String(password).slice(0, 128);

    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(u)) {
      return res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, _ or -)' });
    }
    if (p.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const allowedRoles = ['user', 'reseller', 'admin'];
    const safeRole = allowedRoles.includes(role) ? role : 'user';

    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [u] });
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already exists' });

    const hashed = await bcrypt.hash(p, 12);
    await db.execute({
      sql: 'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      args: [u, hashed, safeRole]
    });

    res.json({ message: 'User created successfully', username: u, role: safeRole });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', rateLimit(10, 60000), async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Invalid credentials' });

    const u = String(username).trim().slice(0, 64);
    const p = String(password).slice(0, 128);

    const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [u] });
    if (result.rows.length === 0) {
      // Constant-time response to prevent username enumeration
      await bcrypt.hash('dummy', 12);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(p, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    if (user.is_banned) return res.status(403).json({ error: 'Account suspended. Contact support.' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '2h', algorithm: 'HS256' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, credits: user.credits, total_recharged: user.total_recharged }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT id, username, role, credits, total_recharged, created_at FROM users WHERE id = ?',
      args: [req.user.id]
    });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADMIN USER MANAGEMENT ====================

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await db.execute("SELECT id, username, role, credits, total_recharged, is_banned, created_at FROM users WHERE COALESCE(role,'user') != 'admin' ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/users/:id/credits', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { credits, operation } = req.body;
    
    const user = await db.execute({ sql: 'SELECT credits, total_recharged FROM users WHERE id = ?', args: [id] });
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    let newCredits = user.rows[0].credits;
    let newTotal = user.rows[0].total_recharged || 0;

    if (operation === 'add') {
      newCredits += parseFloat(credits);
      newTotal += parseFloat(credits);
    } else if (operation === 'remove') {
      newCredits -= parseFloat(credits);
      if (newCredits < 0) newCredits = 0;
    } else {
      newCredits = parseFloat(credits);
    }

    await db.execute({
      sql: 'UPDATE users SET credits = ?, total_recharged = ? WHERE id = ?',
      args: [newCredits, newTotal, id]
    });

    res.json({ message: 'Credits updated', credits: newCredits });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/users/:id/ban', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_banned } = req.body;
    await db.execute({ sql: 'UPDATE users SET is_banned = ? WHERE id = ?', args: [is_banned ? 1 : 0, id] });
    res.json({ message: is_banned ? 'User banned' : 'User unbanned' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [req.params.id] });
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PRODUCTS ====================

app.get('/api/products', async (req, res) => {
  try {
    const products = await db.execute('SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC');
    const withDays = await Promise.all(products.rows.map(async (p) => {
      const days = await db.execute({ sql: 'SELECT * FROM product_days WHERE product_id = ? ORDER BY days', args: [p.id] });
      return { ...p, available_days: days.rows };
    }));
    res.json(withDays);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/products', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, image_url, key_type, custom_key_pattern, days_config } = req.body;
    
    const prod = await db.execute({
      sql: 'INSERT INTO products (name, image_url, key_type, custom_key_pattern) VALUES (?, ?, ?, ?)',
      args: [name, image_url || '', key_type, custom_key_pattern || '']
    });

    const productId = prod.lastInsertRowid;

    if (days_config && Array.isArray(days_config)) {
      for (const cfg of days_config) {
        await db.execute({
          sql: 'INSERT INTO product_days (product_id, days, price) VALUES (?, ?, ?)',
          args: [productId, cfg.days, cfg.price]
        });
      }
    }

    res.json({ message: 'Product created', product_id: productId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/products/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, image_url, key_type, custom_key_pattern, is_active } = req.body;
    await db.execute({
      sql: 'UPDATE products SET name = ?, image_url = ?, key_type = ?, custom_key_pattern = ?, is_active = ? WHERE id = ?',
      args: [name, image_url, key_type, custom_key_pattern, is_active ? 1 : 0, req.params.id]
    });
    res.json({ message: 'Product updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/products/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, image_url, key_type, custom_key_pattern, days_config } = req.body;
    
    await db.execute({
      sql: 'UPDATE products SET name = ?, image_url = ?, key_type = ?, custom_key_pattern = ? WHERE id = ?',
      args: [name, image_url || '', key_type || 'random', custom_key_pattern || '', req.params.id]
    });

    if (days_config && Array.isArray(days_config)) {
      await db.execute({ sql: 'DELETE FROM product_days WHERE product_id = ?', args: [req.params.id] });
      for (const cfg of days_config) {
        await db.execute({
          sql: 'INSERT INTO product_days (product_id, days, price) VALUES (?, ?, ?)',
          args: [req.params.id, cfg.days, cfg.price]
        });
      }
    }

    res.json({ message: 'Product updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/products/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.execute({ sql: 'DELETE FROM product_days WHERE product_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM key_pool WHERE product_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM products WHERE id = ?', args: [id] });
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/products/:id/days', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.execute({
      sql: 'INSERT INTO product_days (product_id, days, price) VALUES (?, ?, ?)',
      args: [req.params.id, req.body.days, req.body.price]
    });
    res.json({ message: 'Day option added' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/product-days/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM product_days WHERE id = ?', args: [req.params.id] });
    res.json({ message: 'Day option deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== KEY POOL ====================

app.post('/api/admin/keys/upload', authenticate, requireAdmin, async (req, res) => {
  try {
    const { product_id, days, keys } = req.body;
    if (!keys || !product_id || !days) return res.status(400).json({ error: 'All fields required' });

    const keyList = keys.split('\n').map(k => k.trim()).filter(k => k);
    let inserted = 0;

    for (const keyValue of keyList) {
      await db.execute({
        sql: 'INSERT INTO key_pool (product_id, days, key_value) VALUES (?, ?, ?)',
        args: [product_id, days, keyValue]
      });
      inserted++;
    }

    res.json({ message: `${inserted} keys uploaded` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/keys', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT k.*, p.name as product_name 
      FROM key_pool k 
      JOIN products p ON k.product_id = p.id 
      ORDER BY k.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/keys/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM key_pool WHERE id = ?', args: [req.params.id] });
    res.json({ message: 'Key deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== LICENSES & PURCHASE ====================

app.post('/api/licenses/buy', authenticate, async (req, res) => {
  try {
    const { product_id, days } = req.body;
    const username = req.user.username;

    const dayConfig = await db.execute({
      sql: 'SELECT * FROM product_days WHERE product_id = ? AND days = ?',
      args: [product_id, days]
    });
    if (dayConfig.rows.length === 0) return res.status(400).json({ error: 'Invalid product or days' });

    const price = dayConfig.rows[0].price;

    const user = await db.execute({
      sql: 'SELECT credits FROM users WHERE id = ?',
      args: [req.user.id]
    });
    if (user.rows[0].credits < price) return res.status(400).json({ error: 'Insufficient credits' });

    const availableKey = await db.execute({
      sql: 'SELECT * FROM key_pool WHERE product_id = ? AND days = ? AND is_used = 0 LIMIT 1',
      args: [product_id, days]
    });
    if (availableKey.rows.length === 0) return res.status(400).json({ error: 'Out of Stock' });

    const keyData = availableKey.rows[0];
    const product = await db.execute({ sql: 'SELECT name FROM products WHERE id = ?', args: [product_id] });

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(days));

    await db.execute({ sql: 'UPDATE users SET credits = credits - ? WHERE id = ?', args: [price, req.user.id] });
    await db.execute({
      sql: 'UPDATE key_pool SET is_used = 1, used_by = ?, used_at = datetime(\'now\') WHERE id = ?',
      args: [username, keyData.id]
    });
    await db.execute({
      sql: `INSERT INTO licenses (key, username, product_id, days, product_name, total_credits, expiry_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      args: [keyData.key_value, username, product_id, days, product.rows[0].name, price, expiryDate.toISOString()]
    });

    res.json({ message: 'Purchase successful', license: keyData.key_value, expiry: expiryDate.toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/licenses/my', authenticate, async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT l.*, CASE WHEN h.id IS NOT NULL THEN 1 ELSE 0 END as hwid_pending 
            FROM licenses l 
            LEFT JOIN hwid_requests h ON l.id = h.license_id AND h.status = 'pending' 
            WHERE l.username = ? 
            ORDER BY l.created_at DESC`,
      args: [req.user.username]
    });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/licenses/:id/reset', authenticate, async (req, res) => {
  try {
    const license = await db.execute({
      sql: 'SELECT * FROM licenses WHERE id = ? AND username = ?',
      args: [req.params.id, req.user.username]
    });
    if (license.rows.length === 0) return res.status(404).json({ error: 'License not found' });

    // Check if there is already a pending request
    const pending = await db.execute({
      sql: 'SELECT * FROM hwid_requests WHERE license_id = ? AND status = "pending"',
      args: [req.params.id]
    });
    if (pending.rows.length > 0) return res.status(400).json({ error: 'Reset request already pending approval' });

    await db.execute({
      sql: 'INSERT INTO hwid_requests (license_id, username) VALUES (?, ?)',
      args: [req.params.id, req.user.username]
    });

    res.json({ message: 'HWID reset requested successfully. Waiting for admin approval.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin HWID requests
app.get('/api/admin/hwid-requests', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await db.execute('SELECT r.*, l.key as license_key FROM hwid_requests r JOIN licenses l ON r.license_id = l.id ORDER BY r.created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/hwid-requests/:id/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    const request = await db.execute({
      sql: 'SELECT * FROM hwid_requests WHERE id = ?',
      args: [req.params.id]
    });
    if (request.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    await db.execute({
      sql: 'UPDATE licenses SET hwid = NULL, last_reset = datetime(\'now\') WHERE id = ?',
      args: [request.rows[0].license_id]
    });

    await db.execute({
      sql: 'UPDATE hwid_requests SET status = "completed", resolved_at = datetime(\'now\') WHERE id = ?',
      args: [req.params.id]
    });

    res.json({ message: 'HWID reset approved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/hwid-requests/:id/reject', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.execute({
      sql: 'UPDATE hwid_requests SET status = "rejected", resolved_at = datetime(\'now\') WHERE id = ?',
      args: [req.params.id]
    });
    res.json({ message: 'HWID reset rejected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/licenses', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM licenses ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYMENTS (BINANCE API) ====================

app.post('/api/payments/create', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    
    // Fetch live deposit address from Binance
    const binanceAddress = await fetchBinanceDepositAddress();

    const orderId = `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.execute({
      sql: 'INSERT INTO payments (username, order_id, amount, status) VALUES (?, ?, ?, ?)',
      args: [req.user.username, orderId, amount, 'pending']
    });

    res.json({
      orderId,
      amount,
      binanceAddress: binanceAddress,
      status: 'pending',
      message: 'Send USDT to the Binance address, then submit your Transaction ID below.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VERIFY TXID WITH BINANCE API
app.post('/api/payments/verify', rateLimit(20, 60000), authenticate, async (req, res) => {
  try {
    const { orderId, txId } = req.body;
    if (!orderId || !txId) return res.status(400).json({ error: 'Order ID and Transaction ID required' });

    // Validate TXID format to prevent injection / garbage input
    const cleanTxId = String(txId).trim();
    if (!/^[a-fA-F0-9]{20,80}$/.test(cleanTxId)) {
      return res.status(400).json({ error: 'Invalid Transaction ID format. Copy it directly from Binance.' });
    }

    // Check if txId already used
    const existing = await db.execute({
      sql: 'SELECT * FROM payments WHERE tx_id = ? AND status = ?',
      args: [cleanTxId, 'completed']
    });
    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: 'DUPLICATE TRANSACTION', 
        message: 'This Transaction ID has already been used. Each transaction can only be used once.' 
      });
    }

    // Get payment details
    const payment = await db.execute({
      sql: 'SELECT * FROM payments WHERE order_id = ? AND username = ?',
      args: [orderId, req.user.username]
    });
    if (payment.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    if (payment.rows[0].status === 'completed') return res.status(400).json({ error: 'Order already completed' });

    // Verify with Binance API
    const expectedAmount = payment.rows[0].amount;
    const verification = await verifyBinanceDeposit(cleanTxId, expectedAmount);

    if (!verification.valid) {
      return res.status(400).json({ error: verification.message });
    }

    // Success - add credits
    const credits = parseFloat(verification.amount);
    await db.execute({
      sql: 'UPDATE payments SET status = ?, tx_id = ?, credits_added = ?, approved_date = datetime(\'now\') WHERE order_id = ?',
      args: ['completed', cleanTxId, credits, orderId]
    });
    await db.execute({
      sql: 'UPDATE users SET credits = credits + ?, total_recharged = total_recharged + ? WHERE username = ?',
      args: [credits, credits, req.user.username]
    });

    res.json({ 
      message: '✅ Payment verified and credits added!', 
      creditsAdded: credits,
      txId: txId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/payments/my', authenticate, async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM payments WHERE username = ? ORDER BY date DESC',
      args: [req.user.username]
    });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/payments', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM payments ORDER BY date DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/payments/:id/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { credits } = req.body;
    const payment = await db.execute({ sql: 'SELECT * FROM payments WHERE id = ?', args: [id] });
    if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    const username = payment.rows[0].username;
    await db.execute({
      sql: 'UPDATE payments SET status = ?, credits_added = ?, approved_date = datetime(\'now\'), approved_by = ? WHERE id = ?',
      args: ['completed', credits, req.user.username, id]
    });
    await db.execute({
      sql: 'UPDATE users SET credits = credits + ?, total_recharged = total_recharged + ? WHERE username = ?',
      args: [credits, credits, username]
    });

    res.json({ message: 'Payment approved manually' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/payments/:id/reject', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await db.execute({ sql: 'SELECT * FROM payments WHERE id = ?', args: [id] });
    if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    await db.execute({
      sql: 'UPDATE payments SET status = ?, approved_date = datetime(\'now\'), approved_by = ? WHERE id = ?',
      args: ['failed', req.user.username, id]
    });

    res.json({ message: 'Payment rejected manually' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== NOTIFICATIONS ====================

app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM notifications WHERE is_global = 1 OR target_user = ? ORDER BY created_at DESC',
      args: [req.user.username]
    });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
  try {
    const notif = await db.execute({ sql: 'SELECT read_by FROM notifications WHERE id = ?', args: [req.params.id] });
    if (notif.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    let readBy = JSON.parse(notif.rows[0].read_by || '[]');
    if (!readBy.includes(req.user.username)) readBy.push(req.user.username);

    await db.execute({ sql: 'UPDATE notifications SET read_by = ? WHERE id = ?', args: [JSON.stringify(readBy), req.params.id] });
    res.json({ message: 'Marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/notifications', authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, message, target_user, is_global } = req.body;
    await db.execute({
      sql: 'INSERT INTO notifications (title, message, target_user, is_global, created_by) VALUES (?, ?, ?, ?, ?)',
      args: [title, message, target_user || null, is_global ? 1 : 0, req.user.username]
    });
    res.json({ message: 'Notification sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== STATS & CONFIG ====================

app.get('/api/config', (req, res) => {
  res.json({
    logoUrl: process.env.SITE_LOGO_URL || 'https://i.postimg.cc/tCDgJy6Y/IMG-20260628-153910-667.jpg'
  });
});

app.get('/api/stats/top-resellers', authenticate, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT username, total_recharged 
      FROM users 
      WHERE total_recharged > 0 
      ORDER BY total_recharged DESC 
      LIMIT 3
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users, revenue, keysSold, activeLic, products, pending, pendingHwid] = await Promise.all([
      db.execute("SELECT COUNT(*) as c FROM users WHERE COALESCE(role,'user') != 'admin'"),
      db.execute('SELECT SUM(total_recharged) as t FROM users'),
      db.execute('SELECT COUNT(*) as c FROM licenses'),
      db.execute('SELECT COUNT(*) as c FROM licenses WHERE status = \'active\' AND expiry_date > datetime(\'now\')'),
      db.execute('SELECT COUNT(*) as c FROM products'),
      db.execute('SELECT COUNT(*) as c FROM payments WHERE status = \'pending\''),
      db.execute('SELECT COUNT(*) as c FROM hwid_requests WHERE status = \'pending\'')
    ]);

    res.json({
      totalUsers: users.rows[0].c,
      totalRevenue: revenue.rows[0].t || 0,
      totalKeysSold: keysSold.rows[0].c,
      activeLicenses: activeLic.rows[0].c,
      totalProducts: products.rows[0].c,
      pendingPayments: pending.rows[0].c,
      pendingHwidResets: pendingHwid.rows[0].c
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// NOTE: /api/seed-admin has been removed for security.
// Admin users are provisioned via ADMIN_USERNAME / ADMIN_PASSWORD environment variables only.

// ==================== SERVE REACT FRONTEND ====================
app.use(express.static(path.join(__dirname, 'client/build')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
