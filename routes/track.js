const express = require('express');
const router = express.Router();

// セッション開始
router.post('/session', (req, res) => {
  const { sessionId, lpId, userAgent, viewportWidth, viewportHeight, referrer } = req.body;
  if (!sessionId || !lpId) return res.status(400).json({ error: 'sessionId and lpId required' });

  // 既存セッションは無視 (INSERT OR IGNORE相当)
  const existing = req.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
  if (!existing) {
    req.db.prepare(`
      INSERT INTO sessions (id, lp_id, user_agent, viewport_width, viewport_height, referrer)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, lpId, userAgent || '', viewportWidth || 0, viewportHeight || 0, referrer || '');
  }
  res.json({ ok: true });
});

// イベントバッチ送信
router.post('/events', (req, res) => {
  const { sessionId, lpId, events } = req.body;
  if (!sessionId || !lpId || !Array.isArray(events)) {
    return res.status(400).json({ error: 'sessionId, lpId, and events[] required' });
  }

  const stmt = req.db.prepare(`
    INSERT INTO events (session_id, lp_id, event_type, step_index, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const evt of events) {
    stmt.run(
      sessionId,
      lpId,
      evt.type,
      evt.stepIndex ?? null,
      evt.data ? JSON.stringify(evt.data) : null,
      evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString()
    );
  }

  res.json({ ok: true, count: events.length });
});

// Beacon API用
router.post('/beacon', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  }

  const { sessionId, lpId, events } = body;
  if (!sessionId || !lpId || !Array.isArray(events)) return res.status(400).end();

  const stmt = req.db.prepare(`
    INSERT INTO events (session_id, lp_id, event_type, step_index, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const evt of events) {
    stmt.run(
      sessionId,
      lpId,
      evt.type,
      evt.stepIndex ?? null,
      evt.data ? JSON.stringify(evt.data) : null,
      evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString()
    );
  }

  res.status(204).end();
});

module.exports = router;
