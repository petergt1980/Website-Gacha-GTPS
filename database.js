const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Pakai /data kalau di Render, atau ./data kalau local
const dataDir = process.env.RENDER_DISK_PATH 
  ? path.join(process.env.RENDER_DISK_PATH) 
  : path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'gtps.db'));
db.pragma('journal_mode = WAL');

// ... sisanya sama seperti sebelumnya

// Buat tabel-tabel
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    growid TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    gems INTEGER DEFAULT 1000,
    wl INTEGER DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    rarity TEXT NOT NULL DEFAULT 'common',
    drop_rate REAL NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    price_gems INTEGER NOT NULL DEFAULT 100,
    price_wl INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    item_icon TEXT NOT NULL,
    item_rarity TEXT NOT NULL,
    obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Seed default data kalau kosong
const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
if (itemCount === 0) {
  const insertItem = db.prepare('INSERT INTO items (name, icon, rarity, drop_rate) VALUES (?, ?, ?, ?)');
  const items = [
    ['Dirt Block', '🟫', 'common', 35],
    ['Cave BG', '🪨', 'common', 25],
    ['Lava', '🔥', 'uncommon', 18],
    ['Chandelier', '🏮', 'rare', 12],
    ['Magplant', '🧲', 'epic', 7],
    ['Gaia Beacon', '🌍', 'legendary', 3]
  ];
  const insertMany = db.transaction((arr) => {
    for (const it of arr) insertItem.run(...it);
  });
  insertMany(items);
  console.log('✅ Items default dibuat');
}

const bannerCount = db.prepare('SELECT COUNT(*) as c FROM banners').get().c;
if (bannerCount === 0) {
  const insertBanner = db.prepare('INSERT INTO banners (name, icon, price_gems, price_wl) VALUES (?, ?, ?, ?)');
  const banners = [
    ['Starter Pack', '📦', 100, 1],
    ['Rare Box', '🎁', 500, 5],
    ['Epic Crate', '💎', 1000, 10],
    ['Legendary Spin', '🏆', 2500, 25],
    ['VIP Gacha', '👑', 5000, 50]
  ];
  const insertMany = db.transaction((arr) => {
    for (const b of arr) insertBanner.run(...b);
  });
  insertMany(banners);
  console.log('✅ Banners default dibuat');
}

module.exports = db;