// 顧客向けLINE追加レポートAPI (report_token 認証、Basic認証なし)
// ページ本体は server.js の GET /report/line/:token → public/report/line.html

const express = require('express');
const router = express.Router();
const { getLineDaily } = require('../services/line-analytics');

router.get('/:token/daily', (req, res) => {
  const token = req.params.token || '';
  if (!/^[a-f0-9]{32}$/.test(token)) return res.status(404).json({ error: 'not found' });

  const account = req.db.prepare('SELECT id, name FROM line_accounts WHERE report_token = ?').get(token);
  if (!account) return res.status(404).json({ error: 'not found' });

  try {
    const data = getLineDaily(req.db, account.id, req.query.from || null, req.query.to || null);
    res.json({ account: { name: account.name }, ...data });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
