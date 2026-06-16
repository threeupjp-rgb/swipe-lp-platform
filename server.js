const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// sharp のプロセス全体メモリ抑制 (require だけで効くので早期に呼ぶ)
try {
  const sharp = require('sharp');
  sharp.cache(false);
  sharp.concurrency(1);
} catch (e) {
  console.warn('[MEM] sharp not installed, skipping memory tuning');
}

const app = express();
const PORT = process.env.PORT || 3000;

// 起動時メモリログ
const _startMem = process.memoryUsage();
console.log(`[MEM] startup rss=${Math.round(_startMem.rss/1024/1024)}MB heap=${Math.round(_startMem.heapUsed/1024/1024)}MB`);

// DB初期化 (Persistent Disk対応)
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'db');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'swipelp.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA cache_size = -2000');   // SQLiteページキャッシュを2MBに制限
db.exec('PRAGMA mmap_size = 0');         // mmap無効化 (RSS急増を防ぐ)
db.exec('PRAGMA temp_store = FILE');     // 一時テーブルをディスクへ

// スキーマ実行
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// マイグレーション: UTM列追加 (既存DBに列がない場合)
for (const col of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
  try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`); } catch {}
}

// マイグレーション: 通知設定列追加 (既存DBに列がない場合)
const lpNotifyCols = [
  ['notify_enabled', 'INTEGER DEFAULT 0'],
  ['notify_cvr_threshold', 'REAL DEFAULT 1.0'],
  ['notify_min_sessions', 'INTEGER DEFAULT 50'],
  ['notify_last_sent_at', 'DATETIME'],
];
for (const [col, def] of lpNotifyCols) {
  try { db.exec(`ALTER TABLE lps ADD COLUMN ${col} ${def}`); } catch {}
}

// マイグレーション: CTA カスタマイズ列追加
const lpCtaCols = [
  ['cta_microcopy', 'TEXT'],
  ['cta_color', "TEXT DEFAULT 'line-green'"],
  ['cta_color_custom', 'TEXT'],
  ['cta_show_final_large', 'INTEGER DEFAULT 1'],
];
for (const [col, def] of lpCtaCols) {
  try { db.exec(`ALTER TABLE lps ADD COLUMN ${col} ${def}`); } catch {}
}

// マイグレーション: フォーム機能列追加
const lpFormCols = [
  ['cta_action_type', "TEXT DEFAULT 'url'"],   // 'url' | 'modal_form' | 'embed_form'
  ['form_show_name', 'INTEGER DEFAULT 1'],
  ['form_show_phone', 'INTEGER DEFAULT 1'],
  ['form_show_line_id', 'INTEGER DEFAULT 0'],
  ['form_show_email', 'INTEGER DEFAULT 0'],
  ['form_show_message', 'INTEGER DEFAULT 1'],
  ['form_submit_label', "TEXT"],                  // null なら cta_text 流用
  ['form_success_message', 'TEXT'],
  ['form_notify_email', 'TEXT'],                  // 応募通知の送信先メアド
];
for (const [col, def] of lpFormCols) {
  try { db.exec(`ALTER TABLE lps ADD COLUMN ${col} ${def}`); } catch {}
}

// プライマリドメインへのリダイレクト
// 環境変数 PRIMARY_HOST 設定時、それ以外のホスト (onrender.com等) からのアクセスは301で誘導
// 除外: /health (Renderヘルスチェック), /api/* (Cron Job 等の内部用), /uploads/* (画像直接配信)
const PRIMARY_HOST = (process.env.PRIMARY_HOST || '').trim();
if (PRIMARY_HOST) {
  console.log(`[redirect] PRIMARY_HOST=${PRIMARY_HOST} 設定済み。他ホストからのアクセスは301で誘導`);
  app.use((req, res, next) => {
    const host = (req.headers.host || '').toLowerCase();
    if (!host || host === PRIMARY_HOST.toLowerCase()) return next();
    const path = req.path;
    if (path === '/health' || path.startsWith('/api/') || path.startsWith('/uploads/')) {
      return next();
    }
    return res.redirect(301, `https://${PRIMARY_HOST}${req.originalUrl}`);
  });
}

// ミドルウェア
const cors = require('cors');
const compression = require('compression');
// memLevel=1 で gzip ワークメモリを最小化 (デフォルト8 → ~256KB/req → ~32KB/req)
// threshold=2048 で小さなレスポンスは圧縮しない
app.use(compression({ memLevel: 1, threshold: 2048 }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' }));

// メモリ計測ミドルウェア: 1リクエストで heap が +30MB 超のものを警告ログ
app.use((req, res, next) => {
  const before = process.memoryUsage().heapUsed;
  res.on('finish', () => {
    const after = process.memoryUsage();
    const deltaMB = Math.round((after.heapUsed - before) / 1024 / 1024);
    if (deltaMB >= 30) {
      console.warn(`[MEM] ${req.method} ${req.originalUrl} +${deltaMB}MB → rss=${Math.round(after.rss/1024/1024)}MB heap=${Math.round(after.heapUsed/1024/1024)}MB status=${res.statusCode}`);
    }
  });
  next();
});

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

// ヘルスチェック (Render ゼロダウンタイムデプロイ用)
app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    const m = process.memoryUsage();
    res.json({
      status: 'ok',
      rss_mb: Math.round(m.rss / 1024 / 1024),
      heap_used_mb: Math.round(m.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(m.heapTotal / 1024 / 1024),
      external_mb: Math.round(m.external / 1024 / 1024),
      uptime_sec: Math.round(process.uptime()),
      time: new Date().toISOString()
    });
  } catch (e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

// 公開API (認証不要)
const trackRoutes = require('./routes/track');
app.use('/api/track', trackRoutes);
const submitRoutes = require('./routes/submit');
app.use('/api/submit', submitRoutes);
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

// プロセス終了時にメモリ状況を出力 (OOM時の手がかり)
process.on('SIGTERM', () => {
  const m = process.memoryUsage();
  console.warn(`[MEM] SIGTERM received rss=${Math.round(m.rss/1024/1024)}MB heap=${Math.round(m.heapUsed/1024/1024)}MB`);
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  const m = process.memoryUsage();
  console.error(`[MEM] uncaughtException rss=${Math.round(m.rss/1024/1024)}MB heap=${Math.round(m.heapUsed/1024/1024)}MB`, err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`SwipeLP Platform running at http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard/`);
  console.log(`  Demo LP:   http://localhost:${PORT}/lp/demo-lp-1`);
});
