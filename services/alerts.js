// LP の反応低下を検知して LINE Bot 経由で通知するサービス
// Render Cron Job から /api/admin/check-alerts 経由で叩かれる

const AnalyticsService = require('./analytics');

// 集計対象期間 (日数) - 3日間でCVRを評価することで、1日のブレに影響されにくくする
const LOOKBACK_DAYS = 3;
// 同じLPへの再通知を抑止する最低間隔 (日数)
const COOLDOWN_DAYS = 3;

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * 監視対象LPの直近24時間の数値を集計し、しきい値割れしたものを通知する。
 * @returns {Promise<{checked: number, alerted: number, skipped: number, errors: number, details: Array}>}
 */
async function checkAndNotify(db, env) {
  const lps = db.prepare(`
    SELECT id, name, slug, notify_cvr_threshold, notify_min_sessions, notify_last_sent_at
    FROM lps
    WHERE notify_enabled = 1
  `).all();

  const svc = new AnalyticsService(db);
  const from = isoDaysAgo(LOOKBACK_DAYS);
  const to = isoDaysAgo(0);

  const result = { checked: 0, alerted: 0, skipped: 0, errors: 0, details: [] };
  const cooldownThreshold = new Date(Date.now() - COOLDOWN_DAYS * 86400 * 1000).toISOString();

  for (const lp of lps) {
    result.checked++;
    try {
      // クールダウン中ならスキップ
      if (lp.notify_last_sent_at && lp.notify_last_sent_at > cooldownThreshold) {
        result.skipped++;
        result.details.push({ slug: lp.slug, status: 'cooldown', last: lp.notify_last_sent_at });
        continue;
      }

      const overview = svc.getOverview(lp.id, from, to);

      // 最低セッション数に満たない場合はスキップ (統計的に意味がない)
      if (overview.totalSessions < lp.notify_min_sessions) {
        result.skipped++;
        result.details.push({
          slug: lp.slug,
          status: 'insufficient_data',
          sessions: overview.totalSessions,
          required: lp.notify_min_sessions,
        });
        continue;
      }

      // CVR がしきい値以上ならOK
      if (overview.conversionRate >= lp.notify_cvr_threshold) {
        result.details.push({
          slug: lp.slug,
          status: 'ok',
          cvr: overview.conversionRate,
          threshold: lp.notify_cvr_threshold,
        });
        continue;
      }

      // 通知発火
      const message = formatAlertMessage(lp, overview);
      await sendAlert(env, message);

      db.prepare(`UPDATE lps SET notify_last_sent_at = CURRENT_TIMESTAMP WHERE id = ?`).run(lp.id);
      result.alerted++;
      result.details.push({
        slug: lp.slug,
        status: 'alerted',
        cvr: overview.conversionRate,
        threshold: lp.notify_cvr_threshold,
        sessions: overview.totalSessions,
      });
    } catch (e) {
      result.errors++;
      result.details.push({ slug: lp.slug, status: 'error', error: e.message });
      console.error(`[ALERT] LP ${lp.slug} check failed:`, e);
    }
  }

  return result;
}

function formatAlertMessage(lp, overview) {
  return [
    `⚠️ LP反応低下アラート`,
    ``,
    `📄 ${lp.name}`,
    `🔗 /lp/${lp.slug}`,
    ``,
    `直近${LOOKBACK_DAYS}日間:`,
    `  セッション: ${overview.totalSessions}`,
    `  CVR: ${overview.conversionRate}% (基準 ${lp.notify_cvr_threshold}%)`,
    `  CTA: ${overview.totalCtaClicks}回`,
    `  バウンス率: ${overview.bounceRate}%`,
    `  平均滞在: ${Math.round(overview.avgSessionDuration / 1000)}秒`,
    ``,
    `→ クリエイティブ/オファー見直し検討`,
  ].join('\n');
}

async function sendAlert(env, message) {
  const url = env.ALERT_WEBHOOK_URL;
  const token = env.ALERT_WEBHOOK_TOKEN;
  if (!url || !token) {
    throw new Error('ALERT_WEBHOOK_URL / ALERT_WEBHOOK_TOKEN が未設定');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ source: 'SwipeLP', message }),
  });
  if (!res.ok) {
    throw new Error(`Push failed: ${res.status} ${await res.text()}`);
  }
}

module.exports = { checkAndNotify, sendAlert };
