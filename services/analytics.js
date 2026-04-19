class AnalyticsService {
  constructor(db) {
    this.db = db;
  }

  // 期間フィルタ用のWHERE句を生成
  _dateFilter(alias, from, to) {
    const conditions = [];
    const params = [];
    if (from) { conditions.push(`${alias}.started_at >= ?`); params.push(from); }
    if (to) { conditions.push(`${alias}.started_at <= ?`); params.push(to + ' 23:59:59'); }
    return { sql: conditions.length ? ' AND ' + conditions.join(' AND ') : '', params };
  }

  _eventDateFilter(from, to) {
    if (!from && !to) return { sql: '', params: [] };
    const conditions = [];
    const params = [];
    if (from) { conditions.push(`e.session_id IN (SELECT id FROM sessions WHERE lp_id = e.lp_id AND started_at >= ?)`); params.push(from); }
    if (to) { conditions.push(`e.session_id IN (SELECT id FROM sessions WHERE lp_id = e.lp_id AND started_at <= ?)`); params.push(to + ' 23:59:59'); }
    return { sql: conditions.length ? ' AND ' + conditions.join(' AND ') : '', params };
  }

  getOverview(lpId, from, to) {
    const df = this._dateFilter('s', from, to);

    const totalSessions = this.db.prepare(
      `SELECT COUNT(*) as c FROM sessions s WHERE s.lp_id = ?${df.sql}`
    ).get(lpId, ...df.params).c;

    const edf = this._eventDateFilter(from, to);

    const totalCtaClicks = this.db.prepare(
      `SELECT COUNT(*) as c FROM events e WHERE e.lp_id = ? AND e.event_type = 'cta_click'${edf.sql}`
    ).get(lpId, ...edf.params).c;

    const avgRow = this.db.prepare(`
      SELECT AVG(step_count) as avg_steps FROM (
        SELECT e.session_id, COUNT(DISTINCT e.step_index) as step_count
        FROM events e WHERE e.lp_id = ? AND e.event_type = 'step_view'${edf.sql}
        GROUP BY e.session_id
      )
    `).get(lpId, ...edf.params);
    const avgStepsViewed = avgRow.avg_steps || 0;

    const durRow = this.db.prepare(`
      SELECT AVG(total_dwell) as avg_dur FROM (
        SELECT e.session_id, SUM(json_extract(e.data, '$.duration_ms')) as total_dwell
        FROM events e WHERE e.lp_id = ? AND e.event_type = 'dwell'${edf.sql}
        GROUP BY e.session_id
      )
    `).get(lpId, ...edf.params);
    const avgSessionDuration = durRow.avg_dur || 0;

    const bounceSessions = this.db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT e.session_id, MAX(e.step_index) as max_step
        FROM events e WHERE e.lp_id = ? AND e.event_type = 'step_view'${edf.sql}
        GROUP BY e.session_id
        HAVING max_step = 0
      )
    `).get(lpId, ...edf.params).c;

    const conversionRate = totalSessions > 0 ? (totalCtaClicks / totalSessions * 100) : 0;
    const bounceRate = totalSessions > 0 ? (bounceSessions / totalSessions * 100) : 0;

    return {
      totalSessions,
      totalCtaClicks,
      conversionRate: Math.round(conversionRate * 100) / 100,
      avgStepsViewed: Math.round(avgStepsViewed * 10) / 10,
      avgSessionDuration: Math.round(avgSessionDuration),
      bounceRate: Math.round(bounceRate * 100) / 100
    };
  }

  getStepMetrics(lpId, from, to) {
    const edf = this._eventDateFilter(from, to);

    const views = this.db.prepare(`
      SELECT e.step_index, COUNT(DISTINCT e.session_id) as view_count
      FROM events e WHERE e.lp_id = ? AND e.event_type = 'step_view'${edf.sql}
      GROUP BY e.step_index ORDER BY e.step_index
    `).all(lpId, ...edf.params);

    const dwells = this.db.prepare(`
      SELECT e.step_index, AVG(json_extract(e.data, '$.duration_ms')) as avg_dwell
      FROM events e WHERE e.lp_id = ? AND e.event_type = 'dwell'${edf.sql}
      GROUP BY e.step_index ORDER BY e.step_index
    `).all(lpId, ...edf.params);

    const clicks = this.db.prepare(`
      SELECT e.step_index, COUNT(*) as click_count
      FROM events e WHERE e.lp_id = ? AND e.event_type = 'click'${edf.sql}
      GROUP BY e.step_index ORDER BY e.step_index
    `).all(lpId, ...edf.params);

    const dwellMap = Object.fromEntries(dwells.map(d => [d.step_index, d.avg_dwell]));
    const clickMap = Object.fromEntries(clicks.map(c => [c.step_index, c.click_count]));

    const steps = views.map((v, i) => {
      const nextViewCount = views[i + 1]?.view_count || 0;
      const dropOffRate = v.view_count > 0 ? ((v.view_count - nextViewCount) / v.view_count * 100) : 0;

      return {
        stepIndex: v.step_index,
        viewCount: v.view_count,
        avgDwellTime: Math.round(dwellMap[v.step_index] || 0),
        dropOffRate: Math.round(dropOffRate * 100) / 100,
        clickCount: clickMap[v.step_index] || 0
      };
    });

    return { steps };
  }

  getHeatmap(lpId, stepIndex, from, to) {
    const GRID_X = 50;
    const GRID_Y = 100;
    const edf = this._eventDateFilter(from, to);

    const raw = this.db.prepare(`
      SELECT
        CAST(ROUND(CAST(json_extract(e.data, '$.x') AS REAL) * ${GRID_X}) AS INTEGER) as grid_x,
        CAST(ROUND(CAST(json_extract(e.data, '$.y') AS REAL) * ${GRID_Y}) AS INTEGER) as grid_y,
        COUNT(*) as click_count
      FROM events e
      WHERE e.lp_id = ? AND e.event_type = 'click' AND e.step_index = ?${edf.sql}
      GROUP BY grid_x, grid_y
    `).all(lpId, stepIndex, ...edf.params);

    const totalClicks = this.db.prepare(
      `SELECT COUNT(*) as c FROM events e WHERE e.lp_id = ? AND e.event_type = 'click' AND e.step_index = ?${edf.sql}`
    ).get(lpId, stepIndex, ...edf.params).c;

    return {
      clicks: raw.map(r => ({
        x: r.grid_x / GRID_X,
        y: r.grid_y / GRID_Y,
        count: r.click_count
      })),
      totalClicks,
      resolution: { gridX: GRID_X, gridY: GRID_Y }
    };
  }

  getDwellHeatmap(lpId, from, to) {
    const edf = this._eventDateFilter(from, to);
    const steps = this.db.prepare(`
      SELECT e.step_index,
        AVG(json_extract(e.data, '$.duration_ms')) as avg_dwell,
        MAX(json_extract(e.data, '$.duration_ms')) as max_dwell,
        MIN(json_extract(e.data, '$.duration_ms')) as min_dwell,
        COUNT(*) as sample_count
      FROM events e WHERE e.lp_id = ? AND e.event_type = 'dwell'${edf.sql}
      GROUP BY e.step_index ORDER BY e.step_index
    `).all(lpId, ...edf.params);

    return { steps };
  }

  getFunnel(lpId, from, to) {
    const edf = this._eventDateFilter(from, to);
    const stepViews = this.db.prepare(`
      SELECT e.step_index, COUNT(DISTINCT e.session_id) as unique_sessions
      FROM events e WHERE e.lp_id = ? AND e.event_type = 'step_view'${edf.sql}
      GROUP BY e.step_index ORDER BY e.step_index
    `).all(lpId, ...edf.params);

    const ctaClicks = this.db.prepare(
      `SELECT COUNT(DISTINCT e.session_id) as c FROM events e WHERE e.lp_id = ? AND e.event_type = 'cta_click'${edf.sql}`
    ).get(lpId, ...edf.params).c;

    const totalSessions = stepViews[0]?.unique_sessions || 0;

    const steps = stepViews.map(sv => ({
      label: `Step ${sv.step_index + 1} 表示`,
      count: sv.unique_sessions,
      rate: totalSessions > 0 ? Math.round(sv.unique_sessions / totalSessions * 1000) / 10 : 0
    }));

    steps.push({
      label: 'CTA クリック',
      count: ctaClicks,
      rate: totalSessions > 0 ? Math.round(ctaClicks / totalSessions * 1000) / 10 : 0
    });

    return { steps };
  }

  getSessions(lpId, limit = 50, offset = 0, from, to) {
    const df = this._dateFilter('s', from, to);
    const sessions = this.db.prepare(`
      SELECT s.id, s.viewport_width, s.viewport_height, s.started_at, s.referrer,
        COUNT(e.id) as event_count,
        MAX(e.step_index) as max_step,
        SUM(CASE WHEN e.event_type = 'cta_click' THEN 1 ELSE 0 END) as cta_clicks
      FROM sessions s
      LEFT JOIN events e ON s.id = e.session_id
      WHERE s.lp_id = ?${df.sql}
      GROUP BY s.id
      ORDER BY s.started_at DESC
      LIMIT ? OFFSET ?
    `).all(lpId, ...df.params, limit, offset);

    const total = this.db.prepare(`SELECT COUNT(*) as c FROM sessions s WHERE s.lp_id = ?${df.sql}`).get(lpId, ...df.params).c;

    return { sessions, total };
  }

  getAttribution(lpId, dimension = 'utm_source', from, to) {
    const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'referrer_domain'];
    if (!allowed.includes(dimension)) dimension = 'utm_source';

    let labelExpr;
    if (dimension === 'referrer_domain') {
      // リファラードメインを既知サービスにマッピング
      labelExpr = `
        CASE
          WHEN s.referrer LIKE '%facebook.com%' OR s.referrer LIKE '%fb.com%' OR s.referrer LIKE '%l.facebook%' THEN 'Facebook'
          WHEN s.referrer LIKE '%instagram.com%' THEN 'Instagram'
          WHEN s.referrer LIKE '%tiktok.com%' THEN 'TikTok'
          WHEN s.referrer LIKE '%google.%' THEN 'Google'
          WHEN s.referrer LIKE '%yahoo.co.jp%' OR s.referrer LIKE '%yahoo.com%' THEN 'Yahoo'
          WHEN s.referrer LIKE '%twitter.com%' OR s.referrer LIKE '%t.co%' THEN 'Twitter/X'
          WHEN s.referrer LIKE '%line.me%' OR s.referrer LIKE '%liff.line%' THEN 'LINE'
          WHEN s.referrer = '' OR s.referrer IS NULL THEN '(direct)'
          ELSE s.referrer
        END
      `;
    } else {
      labelExpr = `COALESCE(NULLIF(s.${dimension}, ''), '(direct)')`;
    }

    const df = this._dateFilter('s', from, to);
    const rows = this.db.prepare(`
      SELECT
        ${labelExpr} as label,
        COUNT(DISTINCT s.id) as sessions,
        SUM(CASE WHEN e.event_type = 'cta_click' THEN 1 ELSE 0 END) as cta_clicks,
        AVG(CASE WHEN e.event_type = 'step_view' THEN e.step_index ELSE NULL END) as avg_step
      FROM sessions s
      LEFT JOIN events e ON s.id = e.session_id
      WHERE s.lp_id = ?${df.sql}
      GROUP BY label
      ORDER BY sessions DESC
    `).all(lpId, ...df.params);

    return rows.map(r => ({
      label: r.label,
      sessions: r.sessions,
      ctaClicks: r.cta_clicks,
      cvr: r.sessions > 0 ? Math.round(r.cta_clicks / r.sessions * 1000) / 10 : 0,
      avgStep: Math.round((r.avg_step || 0) * 10) / 10
    }));
  }

  getSessionDetail(sessionId) {
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    const events = this.db.prepare(`
      SELECT event_type, step_index, data, timestamp
      FROM events WHERE session_id = ?
      ORDER BY timestamp ASC
    `).all(sessionId);

    events.forEach(e => {
      if (e.data) e.data = JSON.parse(e.data);
    });

    return { session, events };
  }
}

module.exports = AnalyticsService;
