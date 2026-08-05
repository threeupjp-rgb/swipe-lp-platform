// LINE Webhook: 友だち追加/ブロックイベントを受け付ける
//
// 【アカウント別計測 (友だち追加カウント)】
//   POST /api/line-webhook/:accountId
//   - ダッシュボードの「LINE計測」で登録したアカウントごとの専用URL
//   - Channel Secret 登録済みなら署名検証 (x-line-signature) を行う
//   - follow/unfollow を line_follow_events に保存 → 日次集計・顧客レポートに反映
//
// 【レガシー (ログ出力のみ)】
//   POST /api/line-webhook
//   - 既存用途: 友だち追加時に user_id をRenderログから拾う (フォーム通知先の設定用)

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// LINEイベントの timestamp (msエポック) → 'YYYY-MM-DD HH:MM:SS' (UTC、CURRENT_TIMESTAMPと同形式)
function toUtcDatetime(ms) {
  const d = ms ? new Date(ms) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().replace('T', ' ').slice(0, 19);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// 署名検証: rawBody の HMAC-SHA256 (base64) と x-line-signature を比較
function verifySignature(req, channelSecret) {
  const signature = req.get('x-line-signature') || '';
  const expected = crypto.createHmac('sha256', channelSecret)
    .update(req.rawBody || Buffer.from(''))
    .digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 表示名の取得 (access_token 登録時のみ、失敗しても計測には影響させない)
async function fetchDisplayName(accessToken, userId) {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!r.ok) return null;
    const json = await r.json();
    return json.displayName || null;
  } catch {
    return null;
  }
}

// ===== アカウント別計測エンドポイント =====
router.post('/:accountId', (req, res) => {
  const db = req.db;
  const account = db.prepare('SELECT * FROM line_accounts WHERE id = ?').get(req.params.accountId);
  if (!account) return res.status(404).json({ error: 'unknown account' });

  if (account.channel_secret) {
    if (!verifySignature(req, account.channel_secret)) {
      console.warn(`[LINE計測] 署名不一致 account=${account.name} (${account.id})`);
      return res.status(401).json({ error: 'bad signature' });
    }
  }

  // LINE側は200が返ればOK。保存処理は応答後に行う
  res.status(200).json({ ok: true });

  const events = (req.body && req.body.events) || [];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO line_follow_events
      (account_id, line_user_id, event_type, is_first, webhook_event_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const ev of events) {
    if (ev.type !== 'follow' && ev.type !== 'unfollow') continue;
    const userId = ev.source?.userId || null;
    const ts = toUtcDatetime(ev.timestamp);
    const webhookEventId = ev.webhookEventId || null;

    let isFirst = 0;
    if (ev.type === 'follow') {
      const prior = userId ? db.prepare(`
        SELECT COUNT(*) AS c FROM line_follow_events
        WHERE account_id = ? AND line_user_id = ? AND event_type = 'follow'
      `).get(account.id, userId).c : 0;
      isFirst = prior === 0 ? 1 : 0;
    }

    const r = insert.run(account.id, userId, ev.type, isFirst, webhookEventId, ts);
    if (r.changes === 0) continue; // webhook再送の重複はスキップ

    console.log(`[LINE計測] ${ev.type === 'follow' ? '友だち追加' : 'ブロック/削除'}: account=${account.name} user_id=${userId || '-'}${isFirst ? ' (初回)' : ''}`);

    if (ev.type === 'follow' && account.access_token && userId) {
      const rowId = r.lastInsertRowid;
      fetchDisplayName(account.access_token, userId).then(name => {
        if (name) {
          db.prepare('UPDATE line_follow_events SET display_name = ? WHERE id = ?').run(name, rowId);
        }
      }).catch(() => {});
    }
  }
});

// 疎通確認用 (LINE Developers の Verify ボタンは POST だが、ブラウザ確認用に GET も用意)
router.get('/:accountId', (req, res) => {
  const account = req.db.prepare('SELECT id FROM line_accounts WHERE id = ?').get(req.params.accountId);
  if (!account) return res.status(404).json({ ok: false, error: 'unknown account' });
  res.json({ ok: true, message: 'LINE follow tracking webhook is running' });
});

// ===== レガシー: ログ出力のみ (user_id 確認用) =====
router.post('/', (req, res) => {
  res.status(200).json({ ok: true });

  const events = (req.body && req.body.events) || [];
  for (const event of events) {
    const src = event.source || {};
    const userId = src.userId || 'unknown';
    const groupId = src.groupId || null;
    const roomId = src.roomId || null;
    const type = event.type;

    if (type === 'follow') {
      console.log(`[LINE Webhook] 友だち追加: user_id=${userId}`);
    } else if (type === 'unfollow') {
      console.log(`[LINE Webhook] ブロック/削除: user_id=${userId}`);
    } else if (type === 'join') {
      if (groupId) console.log(`[LINE Webhook] グループに参加: group_id=${groupId}`);
      else if (roomId) console.log(`[LINE Webhook] ルームに参加: room_id=${roomId}`);
    } else if (type === 'leave') {
      if (groupId) console.log(`[LINE Webhook] グループから退出: group_id=${groupId}`);
      else if (roomId) console.log(`[LINE Webhook] ルームから退出: room_id=${roomId}`);
    } else if (type === 'message' && event.message?.type === 'text') {
      const text = event.message.text.slice(0, 100);
      const loc = groupId ? `group_id=${groupId}` : (roomId ? `room_id=${roomId}` : `user_id=${userId}`);
      console.log(`[LINE Webhook] メッセージ: ${loc} text="${text}"`);
    } else {
      const loc = groupId ? `group_id=${groupId}` : (roomId ? `room_id=${roomId}` : `user_id=${userId}`);
      console.log(`[LINE Webhook] event type=${type} ${loc}`);
    }
  }
});

// GET は動作確認用
router.get('/', (req, res) => {
  res.json({ ok: true, message: 'LINE Webhook endpoint is running' });
});

module.exports = router;
