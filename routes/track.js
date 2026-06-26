const express = require('express');
const router = express.Router();

// Prepared Statement をモジュールレベルでキャッシュ (メモリリーク防止)
let stmts = null;
function getStmts(db) {
  if (stmts) return stmts;
  stmts = {
    checkSession: db.prepare('SELECT id FROM sessions WHERE id = ?'),
    insertSession: db.prepare(`
      INSERT INTO sessions (id, lp_id, user_agent, viewport_width, viewport_height, referrer,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertEvent: db.prepare(`
      INSERT INTO events (session_id, lp_id, event_type, step_index, data, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
  };
  return stmts;
}

// セッション開始
router.post('/session', (req, res) => {
  const { sessionId, lpId, userAgent, viewportWidth, viewportHeight, referrer,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body;
  if (!sessionId || !lpId) return res.status(400).json({ error: 'sessionId and lpId required' });

  const s = getStmts(req.db);
  const existing = s.checkSession.get(sessionId);
  if (!existing) {
    s.insertSession.run(sessionId, lpId, userAgent || '', viewportWidth || 0, viewportHeight || 0, referrer || '',
      utm_source || '', utm_medium || '', utm_campaign || '', utm_content || '', utm_term || '');
  }
  res.json({ ok: true });
});

// イベントバッチ送信
router.post('/events', (req, res) => {
  const { sessionId, lpId, events } = req.body;
  if (!sessionId || !lpId || !Array.isArray(events)) {
    return res.status(400).json({ error: 'sessionId, lpId, and events[] required' });
  }

  const s = getStmts(req.db);
  // node:sqlite の DatabaseSync には better-sqlite3 のような .transaction() が無いため、
  // 明示的に BEGIN/COMMIT でバッチを1トランザクションにまとめる（原子的＆高速）。
  req.db.exec('BEGIN');
  try {
    for (const evt of events) {
      s.insertEvent.run(
        sessionId,
        lpId,
        evt.type,
        evt.stepIndex ?? null,
        evt.data ? JSON.stringify(evt.data) : null,
        evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString()
      );
    }
    req.db.exec('COMMIT');
  } catch (e) {
    try { req.db.exec('ROLLBACK'); } catch (_) {}
    throw e;
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

  const s = getStmts(req.db);
  for (const evt of events) {
    s.insertEvent.run(
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
