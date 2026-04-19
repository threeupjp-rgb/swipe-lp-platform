const express = require('express');
const router = express.Router();
const AnalyticsService = require('../services/analytics');

// LP一覧
router.get('/lps', (req, res) => {
  const lps = req.db.prepare('SELECT id, name, slug, cta_text, created_at FROM lps ORDER BY created_at DESC').all();
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
  const { name, slug, config, cta_text, cta_url } = req.body;
  if (!name || !slug || !config) {
    return res.status(400).json({ error: 'name, slug, config は必須です' });
  }

  // slug重複チェック
  const existing = req.db.prepare('SELECT id FROM lps WHERE slug = ?').get(slug);
  if (existing) {
    return res.status(409).json({ error: 'このスラッグは既に使われています' });
  }

  const crypto = require('crypto');
  const id = crypto.randomUUID();
  req.db.prepare(`
    INSERT INTO lps (id, name, slug, config, cta_text, cta_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, slug, JSON.stringify(config), cta_text || 'お問い合わせ', cta_url || '#');

  res.json({ id, slug, url: `/lp/${slug}` });
});

// LP更新
router.put('/lps/:lpId', (req, res) => {
  const lp = req.db.prepare('SELECT id FROM lps WHERE id = ?').get(req.params.lpId);
  if (!lp) return res.status(404).json({ error: 'LP not found' });

  const { name, config, cta_text, cta_url } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
  if (cta_text !== undefined) { updates.push('cta_text = ?'); params.push(cta_text); }
  if (cta_url !== undefined) { updates.push('cta_url = ?'); params.push(cta_url); }

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

module.exports = router;
