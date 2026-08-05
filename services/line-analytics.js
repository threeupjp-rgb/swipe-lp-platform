// LINE友だち追加の日次集計 (JST基準)
// DBの timestamp は UTC (CURRENT_TIMESTAMP / webhookのUTC変換値) のため、
// 集計時は +9時間 して日本時間の「日」に丸める。
// (参考: UTCのまま date() すると 9:00 JST 以前の追加が前日に計上されるズレが出る)

// JSTの今日 'YYYY-MM-DD'
function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setTime(d.getTime() + n * 86400000);
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// アカウントの日次集計を返す
// from/to は JSTの日付 'YYYY-MM-DD'。未指定なら from=データ最古日(なければ29日前), to=今日
function getLineDaily(db, accountId, from, to) {
  const today = jstToday();
  if (to && !DATE_RE.test(to)) throw new Error('to は YYYY-MM-DD 形式で指定してください');
  if (from && !DATE_RE.test(from)) throw new Error('from は YYYY-MM-DD 形式で指定してください');
  if (!to) to = today;

  if (!from) {
    // データ最古日 (追加イベント or 紐付けLPのCTAクリック) を全期間の起点にする
    const oldest = db.prepare(`
      SELECT MIN(d) AS d FROM (
        SELECT MIN(date(timestamp, '+9 hours')) AS d FROM line_follow_events WHERE account_id = ?
        UNION ALL
        SELECT MIN(date(e.timestamp, '+9 hours')) AS d FROM events e
        WHERE e.event_type = 'cta_click'
          AND e.lp_id IN (SELECT id FROM lps WHERE line_account_id = ?)
      )
    `).get(accountId, accountId).d;
    from = oldest || addDays(today, -29);
  }

  if (from > to) [from, to] = [to, from];
  // 異常な広範囲リクエストの防止 (2年で頭打ち)
  if (addDays(from, 731) < to) from = addDays(to, -731);

  // events.timestamp は ISO形式('...T...Z')と'YYYY-MM-DD HH:MM:SS'が混在するため、
  // 文字列比較でなく date() で正規化したJST日付で絞り込む (両形式を正しく解釈できる)
  const followRows = db.prepare(`
    SELECT date(timestamp, '+9 hours') AS d,
           SUM(CASE WHEN event_type = 'follow' THEN 1 ELSE 0 END) AS follows,
           SUM(CASE WHEN event_type = 'follow' AND is_first = 1 THEN 1 ELSE 0 END) AS first_follows,
           SUM(CASE WHEN event_type = 'unfollow' THEN 1 ELSE 0 END) AS unfollows
    FROM line_follow_events
    WHERE account_id = ?
      AND date(timestamp, '+9 hours') BETWEEN ? AND ?
    GROUP BY d
  `).all(accountId, from, to);

  const clickRows = db.prepare(`
    SELECT date(e.timestamp, '+9 hours') AS d, COUNT(*) AS clicks
    FROM events e
    WHERE e.event_type = 'cta_click'
      AND e.lp_id IN (SELECT id FROM lps WHERE line_account_id = ?)
      AND date(e.timestamp, '+9 hours') BETWEEN ? AND ?
    GROUP BY d
  `).all(accountId, from, to);

  const followMap = Object.fromEntries(followRows.map(r => [r.d, r]));
  const clickMap = Object.fromEntries(clickRows.map(r => [r.d, r.clicks]));

  // from〜to の全日を埋める (ゼロの日も行として出す)
  const days = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const f = followMap[d] || {};
    const follows = f.follows || 0;
    const unfollows = f.unfollows || 0;
    const clicks = clickMap[d] || 0;
    days.push({
      date: d,
      clicks,
      follows,
      firstFollows: f.first_follows || 0,
      unfollows,
      net: follows - unfollows,
      followRate: clicks > 0 ? Math.round(follows / clicks * 1000) / 10 : null
    });
  }

  const totals = days.reduce((acc, r) => {
    acc.clicks += r.clicks;
    acc.follows += r.follows;
    acc.firstFollows += r.firstFollows;
    acc.unfollows += r.unfollows;
    return acc;
  }, { clicks: 0, follows: 0, firstFollows: 0, unfollows: 0 });
  totals.net = totals.follows - totals.unfollows;
  totals.followRate = totals.clicks > 0 ? Math.round(totals.follows / totals.clicks * 1000) / 10 : null;

  return { from, to, days, totals };
}

module.exports = { getLineDaily, jstToday };
