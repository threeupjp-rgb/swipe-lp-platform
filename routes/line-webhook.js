// LINE Webhook: 友だち追加/メッセージ受信イベントを受け付ける
// 主な用途: 友だち追加時に user_id をログに出力 → 管理者がRenderログから取得
// LINE Developers Console のチャネル → Webhook URL に以下を設定:
//   https://swipe.advertisement-lp.com/api/line-webhook
// (署名検証は必要なら追加。まずはログ確認優先)

const express = require('express');
const router = express.Router();

router.post('/', (req, res) => {
  // LINE 側は 200 が返れば OK。処理は非同期扱いでOK。
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
      // Bot がグループ/ルームに招待されたイベント。group_id/room_id が判明
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
