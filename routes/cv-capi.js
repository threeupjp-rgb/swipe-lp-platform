const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const CAPI_VERSION = process.env.META_CAPI_VERSION || 'v20.0';

function sha256(s) {
  return crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
}

// POST /api/cv-capi
// ブラウザ fbq と並走でメタ Conversions API に送信。event_id で重複排除。
// pixel_id にトークン未登録なら 204 (無効化扱い・エラーにしない)。
router.post('/', async (req, res) => {
  try {
    const {
      pixel_id,
      event_id,
      event_name = 'Lead',
      event_time,
      fbp,
      fbc,
      event_source_url,
      external_id,
      custom_data
    } = req.body || {};

    if (!pixel_id || !event_id) {
      return res.status(400).json({ error: 'pixel_id, event_id は必須' });
    }

    const row = req.db.prepare(
      'SELECT access_token, test_event_code FROM meta_capi_tokens WHERE pixel_id = ?'
    ).get(pixel_id);
    if (!row) return res.status(204).end();

    const ipAddr = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress
      || null;
    const userAgent = req.headers['user-agent'] || null;

    const userData = {
      client_ip_address: ipAddr,
      client_user_agent: userAgent
    };
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;
    if (external_id) userData.external_id = sha256(external_id);

    const event = {
      event_name,
      event_time: event_time || Math.floor(Date.now() / 1000),
      event_id,
      action_source: 'website',
      event_source_url: event_source_url || null,
      user_data: userData,
      ...(custom_data ? { custom_data } : {})
    };

    const payload = {
      data: [event],
      ...(row.test_event_code ? { test_event_code: row.test_event_code } : {})
    };

    const url = `https://graph.facebook.com/${CAPI_VERSION}/${pixel_id}/events?access_token=${encodeURIComponent(row.access_token)}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.warn('[CAPI] error', r.status, JSON.stringify(json));
      return res.status(502).json({ error: 'meta capi error', detail: json });
    }
    res.json({
      ok: true,
      fbtrace_id: json.fbtrace_id,
      events_received: json.events_received
    });
  } catch (e) {
    console.error('[CAPI] exception', e);
    res.status(500).json({ error: 'internal', message: e.message });
  }
});

module.exports = router;
