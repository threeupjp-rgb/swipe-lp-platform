class AnalyticsService {
  constructor(db) {
    this.db = db;
  }

  getOverview(lpId) {
    const totalSessions = this.db.prepare(
      'SELECT COUNT(*) as c FROM sessions WHERE lp_id = ?'
    ).get(lpId).c;

    const totalCtaClicks = this.db.prepare(
      "SELECT COUNT(*) as c FROM events WHERE lp_id = ? AND event_type = 'cta_click'"
    ).get(lpId).c;

    const avgRow = this.db.prepare(`
      SELECT AVG(step_count) as avg_steps FROM (
        SELECT session_id, COUNT(DISTINCT step_index) as step_count
        FROM events WHERE lp_id = ? AND event_type = 'step_view'
        GROUP BY session_id
      )
    `).get(lpId);
    const avgStepsViewed = avgRow.avg_steps || 0;

    const durRow = this.db.prepare(`
      SELECT AVG(total_dwell) as avg_dur FROM (
        SELECT session_id, SUM(json_extract(data, '$.duration_ms')) as total_dwell
        FROM events WHERE lp_id = ? AND event_type = 'dwell'
        GROUP BY session_id
      )
    `).get(lpId);
    const avgSessionDuration = durRow.avg_dur || 0;

    const bounceSessions = this.db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT session_id, MAX(step_index) as max_step
        FROM events WHERE lp_id = ? AND event_type = 'step_view'
        GROUP BY session_id
        HAVING max_step = 0
      )
    `).get(lpId).c;

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

  getStepMetrics(lpId) {
    const views = this.db.prepare(`
      SELECT step_index, COUNT(DISTINCT session_id) as view_count
      FROM events WHERE lp_id = ? AND event_type = 'step_view'
      GROUP BY step_index ORDER BY step_index
    `).all(lpId);

    const dwells = this.db.prepare(`
      SELECT step_index, AVG(json_extract(data, '$.duration_ms')) as avg_dwell
      FROM events WHERE lp_id = ? AND event_type = 'dwell'
      GROUP BY step_index ORDER BY step_index
    `).all(lpId);

    const clicks = this.db.prepare(`
      SELECT step_index, COUNT(*) as click_count
      FROM events WHERE lp_id = ? AND event_type = 'click'
      GROUP BY step_index ORDER BY step_index
    `).all(lpId);

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

  getHeatmap(lpId, stepIndex) {
    const GRID_X = 50;
    const GRID_Y = 100;

    const raw = this.db.prepare(`
      SELECT
        CAST(ROUND(CAST(json_extract(data, '$.x') AS REAL) * ${GRID_X}) AS INTEGER) as grid_x,
        CAST(ROUND(CAST(json_extract(data, '$.y') AS REAL) * ${GRID_Y}) AS INTEGER) as grid_y,
        COUNT(*) as click_count
      FROM events
      WHERE lp_id = ? AND event_type = 'click' AND step_index = ?
      GROUP BY grid_x, grid_y
    `).all(lpId, stepIndex);

    const totalClicks = this.db.prepare(
      "SELECT COUNT(*) as c FROM events WHERE lp_id = ? AND event_type = 'click' AND step_index = ?"
    ).get(lpId, stepIndex).c;

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

  getDwellHeatmap(lpId) {
    const steps = this.db.prepare(`
      SELECT step_index,
        AVG(json_extract(data, '$.duration_ms')) as avg_dwell,
        MAX(json_extract(data, '$.duration_ms')) as max_dwell,
        MIN(json_extract(data, '$.duration_ms')) as min_dwell,
        COUNT(*) as sample_count
      FROM events WHERE lp_id = ? AND event_type = 'dwell'
      GROUP BY step_index ORDER BY step_index
    `).all(lpId);

    return { steps };
  }

  getFunnel(lpId) {
    const stepViews = this.db.prepare(`
      SELECT step_index, COUNT(DISTINCT session_id) as unique_sessions
      FROM events WHERE lp_id = ? AND event_type = 'step_view'
      GROUP BY step_index ORDER BY step_index
    `).all(lpId);

    const ctaClicks = this.db.prepare(
      "SELECT COUNT(DISTINCT session_id) as c FROM events WHERE lp_id = ? AND event_type = 'cta_click'"
    ).get(lpId).c;

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

  getSessions(lpId, limit = 50, offset = 0) {
    const sessions = this.db.prepare(`
      SELECT s.id, s.viewport_width, s.viewport_height, s.started_at, s.referrer,
        COUNT(e.id) as event_count,
        MAX(e.step_index) as max_step,
        SUM(CASE WHEN e.event_type = 'cta_click' THEN 1 ELSE 0 END) as cta_clicks
      FROM sessions s
      LEFT JOIN events e ON s.id = e.session_id
      WHERE s.lp_id = ?
      GROUP BY s.id
      ORDER BY s.started_at DESC
      LIMIT ? OFFSET ?
    `).all(lpId, limit, offset);

    const total = this.db.prepare('SELECT COUNT(*) as c FROM sessions WHERE lp_id = ?').get(lpId).c;

    return { sessions, total };
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
