// SQLite + uploads の自動バックアップ (R2へ、backup-worker経由)
// 毎日 04:00 JST に実行。CF cron枠を使わず自前タイマーで駆動する。
// 必要な環境変数: BACKUP_URL (workerのURL), BACKUP_TOKEN (Bearer)
// 失敗時は ALERT_WEBHOOK 経由でLINE通知 (alerts.js の sendAlert を流用)

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { sendAlert } = require('./alerts');

// 起動直後の実行判定: 最終バックアップがこれより古ければ即時実行 (取りこぼし自己修復)
const STALE_HOURS = 26;

function jstDateString(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function workerFetch(env, pathname, options = {}) {
  const res = await fetch(`${env.BACKUP_URL}${pathname}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.BACKUP_TOKEN}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`backup-worker ${pathname} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

// DBスナップショット: VACUUM INTO は稼働中でも一貫性のあるコピーを作れる
async function backupDatabase(db, env) {
  const tmpPath = path.join(os.tmpdir(), `swipelp-snapshot-${Date.now()}.db`).replace(/\\/g, '/');
  try {
    db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
    const gz = zlib.gzipSync(fs.readFileSync(tmpPath));
    const key = `db/swipelp-${jstDateString()}.db.gz`;
    const res = await workerFetch(env, `/upload?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: gz,
    });
    const result = await res.json();
    return { key, bytes: gz.length, pruned: result.pruned || [] };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// uploads差分同期: R2に無いファイルだけアップロード (画像はimmutableなので差分で十分)
async function syncUploads(uploadDir, env) {
  if (!fs.existsSync(uploadDir)) return { total: 0, synced: 0 };

  const local = fs.readdirSync(uploadDir).filter(f => {
    try { return fs.statSync(path.join(uploadDir, f)).isFile(); } catch { return false; }
  });

  const listRes = await workerFetch(env, '/list?prefix=uploads/');
  const remote = new Set((await listRes.json()).objects.map(o => o.key));

  let synced = 0;
  for (const file of local) {
    const key = `uploads/${file}`;
    if (remote.has(key)) continue;
    const body = fs.readFileSync(path.join(uploadDir, file));
    await workerFetch(env, `/upload?key=${encodeURIComponent(key)}`, { method: 'PUT', body });
    synced++;
  }
  return { total: local.length, synced };
}

async function runBackup(db, env, opts = {}) {
  const started = Date.now();
  const dbResult = await backupDatabase(db, env);
  const upResult = opts.skipUploads
    ? { total: 0, synced: 0, skipped: true }
    : await syncUploads(opts.uploadDir, env);
  const result = {
    ok: true,
    db: dbResult,
    uploads: upResult,
    durationMs: Date.now() - started,
  };
  console.log(`[BACKUP] done: ${dbResult.key} (${Math.round(dbResult.bytes / 1024)}KB), uploads ${upResult.synced}/${upResult.total} synced, pruned ${dbResult.pruned.length}`);
  return result;
}

// 最終DBバックアップの経過時間 (時間)。無ければ Infinity
async function hoursSinceLastBackup(env) {
  const res = await workerFetch(env, '/list?prefix=db/');
  const { objects } = await res.json();
  if (!objects.length) return Infinity;
  const latest = objects.reduce((a, b) => (a.uploaded > b.uploaded ? a : b));
  return (Date.now() - new Date(latest.uploaded).getTime()) / 3600000;
}

function msUntilNext4amJst() {
  // 04:00 JST = 19:00 UTC (前日)
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 19, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

function scheduleBackup(db, env, uploadDir) {
  if (!env.BACKUP_URL || !env.BACKUP_TOKEN) {
    console.warn('[BACKUP] BACKUP_URL / BACKUP_TOKEN 未設定のため自動バックアップ無効');
    return;
  }

  const run = async (label) => {
    try {
      await runBackup(db, env, { uploadDir });
    } catch (e) {
      console.error(`[BACKUP] ${label} failed:`, e);
      try {
        await sendAlert(env, `🚨 SwipeLP バックアップ失敗 (${label})\n${e.message}\n→ Renderログ確認`);
      } catch (e2) {
        console.error('[BACKUP] alert send failed:', e2.message);
      }
    }
  };

  // 毎日 04:00 JST (setTimeout連鎖でドリフト回避)
  const scheduleNext = () => {
    const ms = msUntilNext4amJst();
    setTimeout(async () => {
      await run('daily');
      scheduleNext();
    }, ms);
    console.log(`[BACKUP] next daily backup in ${Math.round(ms / 60000)} min (04:00 JST)`);
  };
  scheduleNext();

  // 起動2分後: 最終バックアップが古ければ即時実行 (デプロイ跨ぎ・障害後の自己修復)
  setTimeout(async () => {
    try {
      const hours = await hoursSinceLastBackup(env);
      if (hours > STALE_HOURS) {
        console.log(`[BACKUP] last backup ${hours === Infinity ? 'none' : Math.round(hours) + 'h ago'} -> running now`);
        await run('boot-catchup');
      }
    } catch (e) {
      console.error('[BACKUP] staleness check failed:', e.message);
    }
  }, 2 * 60 * 1000);
}

module.exports = { runBackup, scheduleBackup, hoursSinceLastBackup };
