// SwipeLP バックアップ受け口 (R2保存)
// Render上のSwipeLP本体が毎日 04:00 JST に DB スナップショット(gzip)と
// LP画像(uploads)の差分をここへ PUT する。認証は Bearer トークン。
//
// 世代管理 (db/ プレフィックスのみ):
//   - 日次バックアップは60日保持
//   - 毎月1日分 (swipelp-YYYY-MM-01.db.gz) は永久保存
//   - uploads/ は生きた資産のコピーなので削除しない

const RETENTION_DAYS = 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validKey(key) {
  return typeof key === 'string'
    && key.length > 0 && key.length <= 512
    && /^[A-Za-z0-9/_.\-]+$/.test(key)
    && !key.includes('..');
}

async function pruneDbBackups(bucket) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000);
  const deleted = [];
  let cursor;
  do {
    const listed = await bucket.list({ prefix: 'db/', cursor });
    for (const obj of listed.objects) {
      // キー形式: db/swipelp-YYYY-MM-DD.db.gz
      const m = obj.key.match(/^db\/swipelp-(\d{4})-(\d{2})-(\d{2})\.db\.gz$/);
      if (!m) continue;
      if (m[3] === '01') continue; // 月初は永久保存
      const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
      if (d < cutoff) {
        await bucket.delete(obj.key);
        deleted.push(obj.key);
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return deleted;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // 認証 (BACKUP_TOKEN は wrangler secret)
    const auth = req.headers.get('Authorization') || '';
    if (!env.BACKUP_TOKEN || auth !== `Bearer ${env.BACKUP_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    const key = url.searchParams.get('key') || '';

    // アップロード
    if (req.method === 'PUT' && url.pathname === '/upload') {
      if (!validKey(key)) return json({ error: 'invalid key' }, 400);
      const obj = await env.BUCKET.put(key, req.body);
      let pruned = [];
      if (key.startsWith('db/')) {
        try { pruned = await pruneDbBackups(env.BUCKET); } catch (e) { /* prune失敗は致命ではない */ }
      }
      return json({ ok: true, key, size: obj.size, pruned });
    }

    // 一覧 (?prefix= で絞り込み)
    if (req.method === 'GET' && url.pathname === '/list') {
      const prefix = url.searchParams.get('prefix') || '';
      const objects = [];
      let cursor;
      do {
        const listed = await env.BUCKET.list({ prefix, cursor });
        for (const o of listed.objects) {
          objects.push({ key: o.key, size: o.size, uploaded: o.uploaded });
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      return json({ objects });
    }

    // ダウンロード (リストア用)
    if (req.method === 'GET' && url.pathname === '/download') {
      if (!validKey(key)) return json({ error: 'invalid key' }, 400);
      const obj = await env.BUCKET.get(key);
      if (!obj) return json({ error: 'not found' }, 404);
      return new Response(obj.body, {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }

    // 削除 (手動整理用)
    if (req.method === 'DELETE' && url.pathname === '/object') {
      if (!validKey(key)) return json({ error: 'invalid key' }, 400);
      await env.BUCKET.delete(key);
      return json({ ok: true, deleted: key });
    }

    return json({ error: 'not found' }, 404);
  },
};
