const express = require('express');
const router = express.Router();
const AnalyticsService = require('../services/analytics');
const { checkAndNotify } = require('../services/alerts');

// LP一覧
router.get('/lps', (req, res) => {
  const lps = req.db.prepare(`
    SELECT id, name, slug, cta_text, created_at,
      notify_enabled, notify_cvr_threshold, notify_min_sessions, notify_last_sent_at
    FROM lps ORDER BY created_at DESC
  `).all();
  res.json(lps);
});

// LP詳細
router.get('/lps/:lpId', (req, res) => {
  const lp = req.db.prepare('SELECT * FROM lps WHERE id = ?').get(req.params.lpId);
  if (!lp) return res.status(404).json({ error: 'LP not found' });
  lp.config = JSON.parse(lp.config);
  res.json(lp);
});

// LP新規作成
router.post('/lps', (req, res) => {
  const { name, slug, config, cta_text, cta_url,
    cta_microcopy, cta_color, cta_color_custom, cta_show_final_large,
    cta_action_type, form_show_name, form_show_phone, form_show_line_id,
    form_show_email, form_show_message, form_submit_label,
    form_success_message, form_notify_email,
    form_show_area, form_area_label, form_area_placeholder,
    form_top_microcopy, form_success_cta_text, form_success_cta_url, form_multistep } = req.body;
  if (!name || !slug || !config) {
    return res.status(400).json({ error: 'name, slug, config は必須です' });
  }

  const existing = req.db.prepare('SELECT id FROM lps WHERE slug = ?').get(slug);
  if (existing) {
    return res.status(409).json({ error: 'このスラッグは既に使われています' });
  }

  const crypto = require('crypto');
  const id = crypto.randomUUID();
  req.db.prepare(`
    INSERT INTO lps (id, name, slug, config, cta_text, cta_url,
      cta_microcopy, cta_color, cta_color_custom, cta_show_final_large,
      cta_action_type, form_show_name, form_show_phone, form_show_line_id,
      form_show_email, form_show_message, form_submit_label,
      form_success_message, form_notify_email,
      form_show_area, form_area_label, form_area_placeholder,
      form_top_microcopy, form_success_cta_text, form_success_cta_url, form_multistep)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, slug, JSON.stringify(config),
    cta_text || 'お問い合わせ', cta_url || '#',
    cta_microcopy || null,
    cta_color || 'line-green',
    cta_color_custom || null,
    cta_show_final_large === false ? 0 : 1,
    cta_action_type || 'url',
    form_show_name === false ? 0 : 1,
    form_show_phone === false ? 0 : 1,
    form_show_line_id ? 1 : 0,
    form_show_email ? 1 : 0,
    form_show_message === false ? 0 : 1,
    form_submit_label || null,
    form_success_message || null,
    form_notify_email || null,
    form_show_area ? 1 : 0,
    form_area_label || null,
    form_area_placeholder || null,
    form_top_microcopy || null,
    form_success_cta_text || null,
    form_success_cta_url || null,
    form_multistep ? 1 : 0
  );

  res.json({ id, slug, url: `/lp/${slug}` });
});

// LP更新
router.put('/lps/:lpId', (req, res) => {
  const lp = req.db.prepare('SELECT id, slug FROM lps WHERE id = ?').get(req.params.lpId);
  if (!lp) return res.status(404).json({ error: 'LP not found' });

  const { name, slug, config, cta_text, cta_url,
    cta_microcopy, cta_color, cta_color_custom, cta_show_final_large } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (slug !== undefined && slug !== lp.slug) {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'スラッグは半角英数字とハイフンのみ使用できます' });
    }
    const existing = req.db.prepare('SELECT id FROM lps WHERE slug = ? AND id != ?').get(slug, req.params.lpId);
    if (existing) {
      return res.status(409).json({ error: 'このスラッグは既に他のLPで使用されています' });
    }
    updates.push('slug = ?'); params.push(slug);
  }
  if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
  if (cta_text !== undefined) { updates.push('cta_text = ?'); params.push(cta_text); }
  if (cta_url !== undefined) { updates.push('cta_url = ?'); params.push(cta_url); }
  if (cta_microcopy !== undefined) { updates.push('cta_microcopy = ?'); params.push(cta_microcopy || null); }
  if (cta_color !== undefined) { updates.push('cta_color = ?'); params.push(cta_color || 'line-green'); }
  if (cta_color_custom !== undefined) { updates.push('cta_color_custom = ?'); params.push(cta_color_custom || null); }
  if (cta_show_final_large !== undefined) { updates.push('cta_show_final_large = ?'); params.push(cta_show_final_large ? 1 : 0); }

  // フォーム設定
  const { cta_action_type, form_show_name, form_show_phone, form_show_line_id,
    form_show_email, form_show_message, form_submit_label,
    form_success_message, form_notify_email,
    form_show_area, form_area_label, form_area_placeholder,
    form_top_microcopy, form_success_cta_text, form_success_cta_url, form_multistep } = req.body;
  if (cta_action_type !== undefined) {
    if (!['url', 'modal_form', 'embed_form'].includes(cta_action_type)) {
      return res.status(400).json({ error: 'cta_action_type は url / modal_form / embed_form のいずれか' });
    }
    updates.push('cta_action_type = ?'); params.push(cta_action_type);
  }
  if (form_show_name !== undefined) { updates.push('form_show_name = ?'); params.push(form_show_name ? 1 : 0); }
  if (form_show_phone !== undefined) { updates.push('form_show_phone = ?'); params.push(form_show_phone ? 1 : 0); }
  if (form_show_line_id !== undefined) { updates.push('form_show_line_id = ?'); params.push(form_show_line_id ? 1 : 0); }
  if (form_show_email !== undefined) { updates.push('form_show_email = ?'); params.push(form_show_email ? 1 : 0); }
  if (form_show_message !== undefined) { updates.push('form_show_message = ?'); params.push(form_show_message ? 1 : 0); }
  if (form_submit_label !== undefined) { updates.push('form_submit_label = ?'); params.push(form_submit_label || null); }
  if (form_success_message !== undefined) { updates.push('form_success_message = ?'); params.push(form_success_message || null); }
  if (form_notify_email !== undefined) { updates.push('form_notify_email = ?'); params.push(form_notify_email || null); }
  if (form_show_area !== undefined) { updates.push('form_show_area = ?'); params.push(form_show_area ? 1 : 0); }
  if (form_area_label !== undefined) { updates.push('form_area_label = ?'); params.push(form_area_label || null); }
  if (form_area_placeholder !== undefined) { updates.push('form_area_placeholder = ?'); params.push(form_area_placeholder || null); }
  if (form_top_microcopy !== undefined) { updates.push('form_top_microcopy = ?'); params.push(form_top_microcopy || null); }
  if (form_success_cta_text !== undefined) { updates.push('form_success_cta_text = ?'); params.push(form_success_cta_text || null); }
  if (form_success_cta_url !== undefined) { updates.push('form_success_cta_url = ?'); params.push(form_success_cta_url || null); }
  if (form_multistep !== undefined) { updates.push('form_multistep = ?'); params.push(form_multistep ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ error: '更新項目がありません' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.lpId);

  req.db.prepare(`UPDATE lps SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// LP削除
router.delete('/lps/:lpId', (req, res) => {
  const lp = req.db.prepare('SELECT id FROM lps WHERE id = ?').get(req.params.lpId);
  if (!lp) return res.status(404).json({ error: 'LP not found' });

  req.db.prepare('DELETE FROM events WHERE lp_id = ?').run(req.params.lpId);
  req.db.prepare('DELETE FROM sessions WHERE lp_id = ?').run(req.params.lpId);
  req.db.prepare('DELETE FROM lps WHERE id = ?').run(req.params.lpId);
  res.json({ success: true });
});

// 期間パラメータ抽出ヘルパー
function dateParams(query) {
  return { from: query.from || null, to: query.to || null };
}

// 全体概要
router.get('/analytics/:lpId/overview', (req, res) => {
  const svc = new AnalyticsService(req.db);
  const { from, to } = dateParams(req.query);
  res.json(svc.getOverview(req.params.lpId, from, to));
});

// ステップ別メトリクス
router.get('/analytics/:lpId/steps', (req, res) => {
  const svc = new AnalyticsService(req.db);
  const { from, to } = dateParams(req.query);
  res.json(svc.getStepMetrics(req.params.lpId, from, to));
});

// クリックヒートマップ
router.get('/analytics/:lpId/heatmap/:stepIndex', (req, res) => {
  const svc = new AnalyticsService(req.db);
  const { from, to } = dateParams(req.query);
  res.json(svc.getHeatmap(req.params.lpId, parseInt(req.params.stepIndex), from, to));
});

// 滞在時間ヒートマップ
router.get('/analytics/:lpId/dwell-heatmap', (req, res) => {
  const svc = new AnalyticsService(req.db);
  const { from, to } = dateParams(req.query);
  res.json(svc.getDwellHeatmap(req.params.lpId, from, to));
});

// ファネル
router.get('/analytics/:lpId/funnel', (req, res) => {
  const svc = new AnalyticsService(req.db);
  const { from, to } = dateParams(req.query);
  res.json(svc.getFunnel(req.params.lpId, from, to));
});

// 流入元分析
router.get('/analytics/:lpId/attribution', (req, res) => {
  const svc = new AnalyticsService(req.db);
  const dimension = req.query.dimension || 'utm_source';
  const { from, to } = dateParams(req.query);
  res.json(svc.getAttribution(req.params.lpId, dimension, from, to));
});

// セッション一覧
router.get('/analytics/:lpId/sessions', (req, res) => {
  const svc = new AnalyticsService(req.db);
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const { from, to } = dateParams(req.query);
  res.json(svc.getSessions(req.params.lpId, limit, offset, from, to));
});

// 個別セッション詳細
router.get('/analytics/sessions/:sessionId', (req, res) => {
  const svc = new AnalyticsService(req.db);
  const detail = svc.getSessionDetail(req.params.sessionId);
  if (!detail) return res.status(404).json({ error: 'Session not found' });
  res.json(detail);
});

// 通知設定の取得
router.get('/lps/:lpId/notify-settings', (req, res) => {
  const row = req.db.prepare(`
    SELECT notify_enabled, notify_cvr_threshold, notify_min_sessions, notify_last_sent_at
    FROM lps WHERE id = ?
  `).get(req.params.lpId);
  if (!row) return res.status(404).json({ error: 'LP not found' });
  res.json(row);
});

// 通知設定の更新
router.patch('/lps/:lpId/notify-settings', (req, res) => {
  const lp = req.db.prepare('SELECT id FROM lps WHERE id = ?').get(req.params.lpId);
  if (!lp) return res.status(404).json({ error: 'LP not found' });

  const { notify_enabled, notify_cvr_threshold, notify_min_sessions } = req.body;
  const updates = [];
  const params = [];

  if (notify_enabled !== undefined) {
    updates.push('notify_enabled = ?');
    params.push(notify_enabled ? 1 : 0);
  }
  if (notify_cvr_threshold !== undefined) {
    const v = parseFloat(notify_cvr_threshold);
    if (isNaN(v) || v < 0 || v > 100) {
      return res.status(400).json({ error: 'notify_cvr_threshold は 0-100 の数値' });
    }
    updates.push('notify_cvr_threshold = ?');
    params.push(v);
  }
  if (notify_min_sessions !== undefined) {
    const v = parseInt(notify_min_sessions, 10);
    if (isNaN(v) || v < 1) {
      return res.status(400).json({ error: 'notify_min_sessions は 1 以上の整数' });
    }
    updates.push('notify_min_sessions = ?');
    params.push(v);
  }

  if (updates.length === 0) return res.status(400).json({ error: '更新項目がありません' });

  params.push(req.params.lpId);
  req.db.prepare(`UPDATE lps SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// 応募一覧 (LP毎、新しい順)
router.get('/submissions/:lpId', (req, res) => {
  const lp = req.db.prepare('SELECT id, name FROM lps WHERE id = ? OR slug = ?').get(req.params.lpId, req.params.lpId);
  if (!lp) return res.status(404).json({ error: 'LP not found' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const rows = req.db.prepare(`
    SELECT * FROM submissions WHERE lp_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?
  `).all(lp.id, limit, offset);
  const total = req.db.prepare('SELECT COUNT(*) as c FROM submissions WHERE lp_id = ?').get(lp.id).c;
  res.json({ submissions: rows, total, lp_name: lp.name });
});

// 応募1件削除 (誤送信・テスト時のクリーンアップ用)
router.delete('/submissions/:id', (req, res) => {
  const sub = req.db.prepare('SELECT id FROM submissions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  req.db.prepare('DELETE FROM submissions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Cron Job 用: 全監視対象LPを判定して通知発射
// Render Cron Job から basic認証で叩く想定 (basicAuth は server.js でマウント時に適用済み)
router.post('/admin/check-alerts', async (req, res) => {
  try {
    const env = {
      ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
      ALERT_WEBHOOK_TOKEN: process.env.ALERT_WEBHOOK_TOKEN,
    };
    const result = await checkAndNotify(req.db, env);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('check-alerts error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
