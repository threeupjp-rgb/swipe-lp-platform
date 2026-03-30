const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// DB初期化 (Persistent Disk対応)
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'db');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'swipelp.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// スキーマ実行
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// マイグレーション: UTM列追加 (既存DBに列がない場合)
for (const col of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
  try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`); } catch {}
}

// ミドルウェア
const cors = require('cors');
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' }));

// Basic認証 (ダッシュボード・管理API保護)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'swipelp2024';
function basicAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="SwipeLP Dashboard"');
    return res.status(401).send('認証が必要です');
  }
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="SwipeLP Dashboard"');
  res.status(401).send('認証失敗');
}

// DBをリクエストに注入
app.use((req, res, next) => {
  req.db = db;
  next();
});

// 静的ファイル配信
app.use('/viewer', express.static(path.join(__dirname, 'public', 'viewer')));
app.use('/dashboard', basicAuth, express.static(path.join(__dirname, 'public', 'dashboard')));
app.use('/demo', express.static(path.join(__dirname, 'public', 'demo')));
// アップロードディレクトリ (Persistent Disk対応)
const uploadDir = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir, {
  maxAge: '30d',
  immutable: true
}));

// 公開API (認証不要)
const trackRoutes = require('./routes/track');
app.use('/api/track', trackRoutes);
app.get('/api/lp-by-slug/:slug', (req, res) => {
  const lp = db.prepare('SELECT * FROM lps WHERE slug = ?').get(req.params.slug);
  if (!lp) return res.status(404).json({ error: 'LP not found' });
  lp.config = JSON.parse(lp.config);
  res.json(lp);
});

// 管理API (認証必要)
const apiRoutes = require('./routes/api');
const uploadRoutes = require('./routes/upload');
app.use('/api/upload', basicAuth, uploadRoutes);
app.use('/api', basicAuth, apiRoutes);

// LP表示用ルート
app.get('/lp/:slug', (req, res) => {
  const lp = db.prepare('SELECT id FROM lps WHERE slug = ?').get(req.params.slug);
  if (!lp) return res.status(404).send('LP not found');
  res.sendFile(path.join(__dirname, 'public', 'viewer', 'index.html'));
});

// ルートリダイレクト
app.get('/', (req, res) => {
  res.redirect('/dashboard/');
});

app.listen(PORT, () => {
  console.log(`SwipeLP Platform running at http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard/`);
  console.log(`  Demo LP:   http://localhost:${PORT}/lp/demo-lp-1`);
});
