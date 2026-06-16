// Resend API でメール送信
// 環境変数:
//   RESEND_API_KEY: Resendダッシュボードで発行
//   RESEND_FROM_EMAIL: 送信元 (例: 'noreply@advertisement-lp.com')。ドメイン認証必要

async function sendEmail(env, { to, subject, html, text, fromName }) {
  const apiKey = env.RESEND_API_KEY;
  const fromAddress = env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromAddress) {
    console.warn('[mailer] RESEND_API_KEY or RESEND_FROM_EMAIL 未設定、メール送信スキップ');
    return { ok: false, error: 'not_configured' };
  }
  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[mailer] Resend API failed: ${res.status} ${body}`);
      return { ok: false, error: `${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    return { ok: true, id: data.id };
  } catch (e) {
    console.error('[mailer] Resend API error:', e);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendEmail };
