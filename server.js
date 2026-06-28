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
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

    const kt = await db.execute('SELECT * FROM key_types');
    if (kt.rows.length === 0) {
      await db.execute(`
        INSERT INTO key_types (name, description) VALUES 
        ('license_only', 'Single license key (any digits)'),
        ('username_password', 'Username and Password type key')
      `);
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

// ==================== BINANCE API VERIFICATION ====================
async function verifyBinanceDeposit(txId, expectedAmount) {
  try {
    const timestamp = Date.now();
    const queryString = `coin=USDT&timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', process.env.BINANCE_SECRET_KEY)
      .update(queryString)
      .digest('hex');

    const { data } = await axios.get(
      `https://api.binance.com/sapi/v1/capital/deposit/hisrec?${queryString}&signature=${signature}`,
      {
        headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY },
        timeout: 15000
      }
    );

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
    return { valid: false, message: 'Binance API error. Please try again later.' };
  }
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const existing = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already exists' });

    const hashed = await bcrypt.hash(password, 10);
    await db.execute({
      sql: 'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      args: [username, hashed, role || 'user']
    });

    res.json({ message: 'User created successfully', username, role: role || 'user' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    if (user.is_banned) return res.status(403).json({ error: 'Account banned' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, credits: user.credits, total_recharged: user.total_recharged }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const result = await db.execute('SELECT id, username, role, credits, total_recharged, is_banned, created_at FROM users WHERE role != "admin" ORDER BY created_at DESC');
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
      sql: 'UPDATE key_pool SET is_used = 1, used_by = ?, used_at = datetime("now") WHERE id = ?',
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
      sql: 'SELECT * FROM licenses WHERE username = ? ORDER BY created_at DESC',
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

    await db.execute({
      sql: 'UPDATE licenses SET hwid = NULL, last_reset = datetime("now") WHERE id = ?',
      args: [req.params.id]
    });
    res.json({ message: 'HWID reset successful' });
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
    const orderId = `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.execute({
      sql: 'INSERT INTO payments (username, order_id, amount, status) VALUES (?, ?, ?, ?)',
      args: [req.user.username, orderId, amount, 'pending']
    });

    res.json({
      orderId,
      amount,
      binanceAddress: process.env.BINANCE_DEPOSIT_ADDRESS,
      status: 'pending',
      message: 'Send USDT to the Binance address, then submit your Transaction ID below.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VERIFY TXID WITH BINANCE API
app.post('/api/payments/verify', authenticate, async (req, res) => {
  try {
    const { orderId, txId } = req.body;
    if (!orderId || !txId) return res.status(400).json({ error: 'Order ID and Transaction ID required' });

    // Check if txId already used
    const existing = await db.execute({
      sql: 'SELECT * FROM payments WHERE tx_id = ? AND status = ?',
      args: [txId, 'completed']
    });
    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: '⚠️ DUPLICATE TRANSACTION', 
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
    const verification = await verifyBinanceDeposit(txId, expectedAmount);

    if (!verification.valid) {
      return res.status(400).json({ error: verification.message });
    }

    // Success - add credits
    const credits = parseFloat(verification.amount);
    await db.execute({
      sql: 'UPDATE payments SET status = ?, tx_id = ?, credits_added = ?, approved_date = datetime("now") WHERE order_id = ?',
      args: ['completed', txId, credits, orderId]
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
      sql: 'UPDATE payments SET status = ?, credits_added = ?, approved_date = datetime("now"), approved_by = ? WHERE id = ?',
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

// ==================== STATS ====================

app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users, revenue, keysSold, activeLic, products, pending] = await Promise.all([
      db.execute('SELECT COUNT(*) as c FROM users WHERE role != "admin"'),
      db.execute('SELECT SUM(total_recharged) as t FROM users'),
      db.execute('SELECT COUNT(*) as c FROM licenses'),
      db.execute('SELECT COUNT(*) as c FROM licenses WHERE status = "active" AND expiry_date > datetime("now")'),
      db.execute('SELECT COUNT(*) as c FROM products'),
      db.execute('SELECT COUNT(*) as c FROM payments WHERE status = "pending"')
    ]);

    res.json({
      totalUsers: users.rows[0].c,
      totalRevenue: revenue.rows[0].t || 0,
      totalKeysSold: keysSold.rows[0].c,
      activeLicenses: activeLic.rows[0].c,
      totalProducts: products.rows[0].c,
      pendingPayments: pending.rows[0].c
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seed first admin
app.post('/api/seed-admin', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    await db.execute({
      sql: 'INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)',
      args: [username, hashed, 'admin']
    });
    res.json({ message: 'Admin created. Remove this route in production!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SERVE REACT FRONTEND ====================
app.use(express.static(path.join(__dirname, 'client/build')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
