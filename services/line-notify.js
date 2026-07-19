// LINE Messaging API プッシュ通知
// LINE Notify (2025/3/31 終了) の代替として使用

async function sendLinePush(userId, message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.warn('[LINE] LINE_CHANNEL_ACCESS_TOKEN 未設定 - スキップ');
    return { ok: false, reason: 'no_token' };
  }
  if (!userId) {
    return { ok: false, reason: 'no_user_id' };
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: 'text', text: message }]
      })
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[LINE] push failed status=${res.status}`, err.slice(0, 300));
      return { ok: false, status: res.status, error: err };
    }
    return { ok: true };
  } catch (e) {
    console.error('[LINE] push exception', e.message);
    return { ok: false, error: e.message };
  }
}

// フォーム送信内容を LINE 通知用テキストに整形
function formatSubmissionMessage(lp, submission, submissionId) {
  const lines = [
    `新しい応募が届きました`,
    ``,
    `LP: ${lp.name || lp.slug}`
  ];
  if (submission.name) lines.push(`お名前: ${submission.name}`);
  if (submission.phone) lines.push(`電話: ${submission.phone}`);
  if (submission.line_id) lines.push(`LINE ID: ${submission.line_id}`);
  if (submission.email) lines.push(`メール: ${submission.email}`);
  if (submission.area) lines.push(`エリア: ${submission.area}`);
  if (submission.message) lines.push(`メッセージ:\n${submission.message}`);
  if (submission.utm_source || submission.utm_campaign) {
    lines.push(``);
    lines.push(`流入:`);
    if (submission.utm_source) lines.push(`  source: ${submission.utm_source}`);
    if (submission.utm_medium) lines.push(`  medium: ${submission.utm_medium}`);
    if (submission.utm_campaign) lines.push(`  campaign: ${submission.utm_campaign}`);
  }
  lines.push(``);
  lines.push(`受信時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  return lines.join('\n');
}

module.exports = { sendLinePush, formatSubmissionMessage };
