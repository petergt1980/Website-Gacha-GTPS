require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'secret_default_ganti';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// ============ MIDDLEWARE ============
function authUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'member') return res.status(403).json({ error: 'Member only' });
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function authAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    req.admin = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ============ AUTH ============
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username & password required' });

  if (role === 'admin') {
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      const token = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, role: 'admin', username });
    }
    return res.status(401).json({ error: 'Admin credentials salah' });
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(growid) = LOWER(?)').get(username);
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Password salah' });

  const token = jwt.sign({ role: 'member', userId: user.id, username: user.growid }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, role: 'member', username: user.growid });
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Semua field wajib diisi' });
  if (password.length < 4) return res.status(400).json({ error: 'Password minimal 4 karakter' });
  if (username.toLowerCase() === ADMIN_USER.toLowerCase()) return res.status(400).json({ error: 'Username tidak boleh admin' });

  const exists = db.prepare('SELECT id FROM users WHERE LOWER(growid) = LOWER(?)').get(username);
  if (exists) return res.status(400).json({ error: 'GrowID sudah terdaftar' });

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO users (growid, password) VALUES (?, ?)').run(username, hash);
  res.json({ success: true, userId: result.lastInsertRowid });
});

// ============ USER (MEMBER) ============
app.get('/api/me', authUser, (req, res) => {
  const user = db.prepare('SELECT id, growid, gems, wl, created_at FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.get('/api/banners', (req, res) => {
  res.json(db.prepare('SELECT * FROM banners ORDER BY id').all());
});

app.post('/api/spin', authUser, (req, res) => {
  const { bannerId, count = 1 } = req.body;
  const banner = db.prepare('SELECT * FROM banners WHERE id = ?').get(bannerId);
  if (!banner) return res.status(404).json({ error: 'Banner tidak ada' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  const totalCost = banner.price_gems * count;
  if (user.gems < totalCost) return res.status(400).json({ error: 'Gems tidak cukup' });

  const items = db.prepare('SELECT * FROM items').all();
  if (items.length === 0) return res.status(400).json({ error: 'Tidak ada item di database' });

  const rollItem = () => {
    const rand = Math.random() * 100;
    let c = 0;
    for (const it of items) {
      c += parseFloat(it.drop_rate);
      if (rand <= c) return it;
    }
    return items[items.length - 1];
  };

  const results = [];
  const insertInv = db.prepare('INSERT INTO inventory (user_id, item_name, item_icon, item_rarity) VALUES (?, ?, ?, ?)');
  const updateGems = db.prepare('UPDATE users SET gems = gems - ? WHERE id = ?');

  const transaction = db.transaction(() => {
    updateGems.run(totalCost, user.id);
    for (let i = 0; i < count; i++) {
      const r = rollItem();
      insertInv.run(user.id, r.name, r.icon, r.rarity);
      results.push({ name: r.name, icon: r.icon, rarity: r.rarity });
    }
  });
  transaction();

  const updatedUser = db.prepare('SELECT gems, wl FROM users WHERE id = ?').get(user.id);
  res.json({ results, balance: updatedUser });
});

app.get('/api/inventory', authUser, (req, res) => {
  const inv = db.prepare('SELECT * FROM inventory WHERE user_id = ? ORDER BY obtained_at DESC LIMIT 100').all(req.user.userId);
  res.json(inv);
});

// ============ ADMIN ============
app.get('/api/admin/stats', authAdmin, (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
  const bannerCount = db.prepare('SELECT COUNT(*) as c FROM banners').get().c;
  const invCount = db.prepare('SELECT COUNT(*) as c FROM inventory').get().c;
  res.json({ userCount, itemCount, bannerCount, invCount });
});

app.get('/api/admin/users', authAdmin, (req, res) => {
  const users = db.prepare('SELECT u.id, u.growid, u.gems, u.wl, u.created_at, COUNT(i.id) as inv_count FROM users u LEFT JOIN inventory i ON u.id = i.user_id GROUP BY u.id ORDER BY u.id DESC').all();
  res.json(users);
});

app.post('/api/admin/add-balance', authAdmin, (req, res) => {
  const { userId, gems = 0, wl = 0 } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User tidak ada' });
  db.prepare('UPDATE users SET gems = gems + ?, wl = wl + ? WHERE id = ?').run(gems, wl, userId);
  res.json({ success: true });
});

app.post('/api/admin/reset-user', authAdmin, (req, res) => {
  const { userId } = req.body;
  db.prepare('UPDATE users SET gems = 0, wl = 0 WHERE id = ?').run(userId);
  db.prepare('DELETE FROM inventory WHERE user_id = ?').run(userId);
  res.json({ success: true });
});

app.post('/api/admin/delete-user', authAdmin, (req, res) => {
  const { userId } = req.body;
  db.prepare('DELETE FROM inventory WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ success: true });
});

// Items CRUD
app.get('/api/admin/items', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM items ORDER BY id').all());
});

app.post('/api/admin/items/save', authAdmin, (req, res) => {
  const { items } = req.body;
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM items').run();
    const insert = db.prepare('INSERT INTO items (name, icon, rarity, drop_rate) VALUES (?, ?, ?, ?)');
    for (const it of items) {
      insert.run(it.name, it.icon, it.rarity, it.drop_rate);
    }
  });
  transaction();
  res.json({ success: true });
});

// Banners CRUD
app.get('/api/admin/banners', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM banners ORDER BY id').all());
});

app.post('/api/admin/banners/save', authAdmin, (req, res) => {
  const { banners } = req.body;
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM banners').run();
    const insert = db.prepare('INSERT INTO banners (name, icon, price_gems, price_wl) VALUES (?, ?, ?, ?)');
    for (const b of banners) {
      insert.run(b.name, b.icon, b.price_gems, b.price_wl);
    }
  });
  transaction();
  res.json({ success: true });
});

// Export DB
app.get('/api/admin/export', authAdmin, (req, res) => {
  const data = {
    users: db.prepare('SELECT id, growid, gems, wl, created_at FROM users').all(),
    items: db.prepare('SELECT * FROM items').all(),
    banners: db.prepare('SELECT * FROM banners').all(),
    inventory: db.prepare('SELECT * FROM inventory').all()
  };
  res.json(data);
});

// Import DB
app.post('/api/admin/import', authAdmin, (req, res) => {
  const { data } = req.body;
  if (!data || !data.items || !data.banners) return res.status(400).json({ error: 'Data tidak valid' });

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM inventory').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM items').run();
    db.prepare('DELETE FROM banners').run();

    if (data.users) {
      const ins = db.prepare('INSERT INTO users (id, growid, password, gems, wl) VALUES (?, ?, ?, ?, ?)');
      for (const u of data.users) ins.run(u.id, u.growid, 'imported_hash', u.gems || 0, u.wl || 0);
    }
    const insItem = db.prepare('INSERT INTO items (name, icon, rarity, drop_rate) VALUES (?, ?, ?, ?)');
    for (const it of data.items) insItem.run(it.name, it.icon, it.rarity, it.drop_rate);
    const insBanner = db.prepare('INSERT INTO banners (name, icon, price_gems, price_wl) VALUES (?, ?, ?, ?)');
    for (const b of data.banners) insBanner.run(b.name, b.icon, b.price_gems, b.price_wl);
  });
  transaction();
  res.json({ success: true });
});

// Reset DB
app.post('/api/admin/reset', authAdmin, (req, res) => {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM inventory').run();
    db.prepare('DELETE FROM users').run();
  });
  transaction();
  res.json({ success: true });
});

// Start
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Penting! Biar bisa diakses dari luar

app.listen(PORT, HOST, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 GTPS GACHA SERVER RUNNING');
  console.log('='.repeat(50));
  console.log(`📡 Local:     http://localhost:${PORT}`);
  console.log(`🌐 Network:   http://0.0.0.0:${PORT}`);
  
  // Tampilkan semua IP address yang aktif
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`🌍 ${name.padEnd(10)} http://${net.address}:${PORT}`);
      }
    }
  }
  
  console.log('-'.repeat(50));
  console.log(`👤 Admin:     ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`🔒 JWT:       ${JWT_SECRET.substring(0, 8)}...`);
  console.log(`💾 Database:  ./data/gtps.db`);
  console.log(`🌡️  Node:     ${process.version}`);
  console.log(`📦 Env:       ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(50) + '\n');
});

// ===== ERROR HANDLING =====
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down...');
  process.exit(0);
});