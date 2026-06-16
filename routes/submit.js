// 公開API: LPフォームからの応募受信
// マウント例: app.use('/api/submit', submitRoutes)

const express = require('express');
const router = express.Router();
const { sendEmail } = require('../services/mailer');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

router.post('/:lpIdOrSlug', async (req, res) => {
  const key = req.params.lpIdOrSlug;
  // id でも slug でも引けるように
  const lp = req.db.prepare('SELECT * FROM lps WHERE id = ? OR slug = ?').get(key, key);
  if (!lp) return res.status(404).json({ error: 'LP not found' });

  const { name, phone, line_id, email, message,
    utm_source, utm_medium, utm_campaign, utm_content, referrer } = req.body || {};

  // 最低1つは入力必須 (全空は弾く)
  if (!name && !phone && !line_id && !email && !message) {
    return res.status(400).json({ error: '入力項目が空です' });
  }

  // 文字数制限 (DoS対策の上限。実用上はもっと小さい)
  const trim = (v, max) => (v == null ? null : String(v).slice(0, max).trim() || null);
  const safe = {
    name: trim(name, 100),
    phone: trim(phone, 50),
    line_id: trim(line_id, 100),
    email: trim(email, 200),
    message: trim(message, 2000),
    utm_source: trim(utm_source, 100),
    utm_medium: trim(utm_medium, 100),
    utm_campaign: trim(utm_campaign, 200),
    utm_content: trim(utm_content, 200),
    referrer: trim(referrer, 500),
  };
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

  const result = req.db.prepare(`
    INSERT INTO submissions (lp_id, name, phone, line_id, email, message,
      utm_source, utm_medium, utm_campaign, utm_content, referrer, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lp.id,
    safe.name, safe.phone, safe.line_id, safe.email, safe.message,
    safe.utm_source, safe.utm_medium, safe.utm_campaign, safe.utm_content,
    safe.referrer, userAgent
  );

  // メール通知 (非同期で送信、応募保存自体は確定済み)
  if (lp.form_notify_email) {
    const env = {
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    };
    const lines = [];
    if (safe.name)     lines.push(`お名前: ${safe.name}`);
    if (safe.phone)    lines.push(`電話番号: ${safe.phone}`);
    if (safe.line_id)  lines.push(`LINE ID: ${safe.line_id}`);
    if (safe.email)    lines.push(`メール: ${safe.email}`);
    if (safe.message)  lines.push(`メッセージ:\n${safe.message}`);
    const meta = [];
    if (safe.utm_source)   meta.push(`流入元: ${safe.utm_source}`);
    if (safe.utm_medium)   meta.push(`媒体: ${safe.utm_medium}`);
    if (safe.utm_campaign) meta.push(`キャンペーン: ${safe.utm_campaign}`);
    if (safe.referrer)     meta.push(`リファラ: ${safe.referrer}`);
    const ts = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const text = `LP: ${lp.name}\n/lp/${lp.slug}\n\n${lines.join('\n')}\n\n${meta.join('\n')}\n\n送信時刻: ${ts}`;
    const html = `<div style="font-family:'Hiragino Sans',sans-serif;line-height:1.7;color:#111;max-width:560px;">
      <h2 style="border-bottom:2px solid #6366f1;padding-bottom:8px;">📨 新規応募 / ${escapeHtml(lp.name)}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
        ${[
          ['お名前', safe.name], ['電話番号', safe.phone], ['LINE ID', safe.line_id],
          ['メール', safe.email], ['メッセージ', safe.message ? safe.message.replace(/\n/g, '<br>') : null]
        ].filter(([_, v]) => v).map(([k, v]) =>
          `<tr><th style="text-align:left;padding:8px;background:#f5f5f5;width:120px;border:1px solid #ddd;">${k}</th><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(v).replace(/&lt;br&gt;/g, '<br>')}</td></tr>`
        ).join('')}
      </table>
      ${meta.length ? `<p style="color:#666;font-size:12px;background:#fafafa;padding:12px;border-radius:6px;">${escapeHtml(meta.join(' / '))}</p>` : ''}
      <p style="color:#999;font-size:12px;margin-top:24px;">送信時刻: ${ts}<br>LP: /lp/${escapeHtml(lp.slug)}</p>
    </div>`;

    sendEmail(env, {
      to: lp.form_notify_email,
      subject: `【新規応募】${lp.name} - ${safe.name || safe.phone || safe.email || '(無名)'}`,
      html, text, fromName: 'SwipeLP 応募通知',
    })
      .then(r => { if (!r.ok) console.error(`[submit] email failed: ${r.error}`); })
      .catch(e => console.error('[submit] email exception:', e));
  }

  res.json({
    ok: true,
    id: result.lastInsertRowid,
    success_message: lp.form_success_message || 'ありがとうございました。担当者よりご連絡いたします。',
  });
});

module.exports = router;
