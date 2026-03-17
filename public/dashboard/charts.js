// Chart.jsを使わず、軽量なSVGチャートを自前実装

const ChartColors = {
  primary: '#6366f1',
  primaryLight: '#818cf8',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  muted: '#71717a',
  steps: ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899']
};

// ファネルチャート描画
function renderFunnel(container, data) {
  container.innerHTML = '';
  const funnelEl = document.createElement('div');
  funnelEl.className = 'funnel';

  const colors = [...ChartColors.steps, ChartColors.success];

  data.steps.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'funnel-step';

    row.innerHTML = `
      <div class="funnel-label">${step.label}</div>
      <div class="funnel-bar-wrap">
        <div class="funnel-bar" style="width: 0%; background: ${colors[i % colors.length]}">
          ${step.rate}%
        </div>
      </div>
      <div class="funnel-count">${step.count.toLocaleString()}</div>
    `;

    funnelEl.appendChild(row);

    // アニメーション
    requestAnimationFrame(() => {
      setTimeout(() => {
        row.querySelector('.funnel-bar').style.width = `${Math.max(step.rate, 5)}%`;
      }, i * 100);
    });
  });

  container.appendChild(funnelEl);
}

// ステップ別テーブル描画
function renderStepTable(container, data) {
  const html = `
    <table class="step-table">
      <thead>
        <tr>
          <th>ステップ</th>
          <th>表示数</th>
          <th>平均滞在</th>
          <th>離脱率</th>
          <th>クリック数</th>
        </tr>
      </thead>
      <tbody>
        ${data.steps.map(s => `
          <tr>
            <td>Step ${s.stepIndex + 1}</td>
            <td>${s.viewCount.toLocaleString()}</td>
            <td>${(s.avgDwellTime / 1000).toFixed(1)}秒</td>
            <td style="color: ${s.dropOffRate > 50 ? ChartColors.danger : s.dropOffRate > 30 ? ChartColors.warning : ChartColors.success}">
              ${s.dropOffRate}%
            </td>
            <td>${s.clickCount.toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  container.innerHTML = html;
}

// 滞在時間バーチャート描画
function renderDwellChart(container, data) {
  container.innerHTML = '';
  const chartEl = document.createElement('div');
  chartEl.className = 'dwell-bar-chart';

  const maxDwell = Math.max(...data.steps.map(s => s.avg_dwell));

  data.steps.forEach((step, i) => {
    const pct = maxDwell > 0 ? (step.avg_dwell / maxDwell * 100) : 0;
    const seconds = (step.avg_dwell / 1000).toFixed(1);

    // 色の選択: 滞在時間が長いほど暖色
    const ratio = step.avg_dwell / maxDwell;
    const color = ratio > 0.7 ? ChartColors.success : ratio > 0.4 ? ChartColors.info : ChartColors.warning;

    const bar = document.createElement('div');
    bar.className = 'dwell-bar';
    bar.innerHTML = `
      <div class="bar-value">${seconds}秒</div>
      <div class="bar" style="height: 0%; background: ${color}"></div>
      <div class="bar-label">Step ${step.step_index + 1}</div>
    `;
    chartEl.appendChild(bar);

    requestAnimationFrame(() => {
      setTimeout(() => {
        bar.querySelector('.bar').style.height = `${Math.max(pct, 5)}%`;
      }, i * 100);
    });
  });

  container.appendChild(chartEl);
}

// セッションリスト描画
function renderSessionList(container, data, onClickSession) {
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'session-list';

  data.sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item';

    let badgeClass = 'engaged';
    let badgeText = `Step ${(session.max_step || 0) + 1}まで`;
    if (session.cta_clicks > 0) {
      badgeClass = 'converted';
      badgeText = 'CV達成';
    } else if (session.max_step === 0 || session.max_step === null) {
      badgeClass = 'bounced';
      badgeText = '離脱';
    }

    const date = new Date(session.started_at);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

    item.innerHTML = `
      <div class="session-meta">
        <div>${dateStr} <span class="device">${session.viewport_width}x${session.viewport_height}</span></div>
        <div class="device">${session.event_count}イベント</div>
      </div>
      <span class="session-badge ${badgeClass}">${badgeText}</span>
    `;

    item.addEventListener('click', () => onClickSession(session.id));
    list.appendChild(item);
  });

  container.appendChild(list);
}

// セッション詳細タイムライン描画
function renderSessionTimeline(container, data) {
  container.innerHTML = '';
  const timeline = document.createElement('div');
  timeline.className = 'timeline';

  const eventLabels = {
    step_view: 'ステップ表示',
    click: 'クリック',
    dwell: '滞在',
    cta_click: 'CTAクリック',
    step_transition: 'ステップ遷移'
  };

  data.events.forEach(evt => {
    const item = document.createElement('div');
    item.className = 'timeline-item' + (evt.event_type === 'cta_click' ? ' cta' : '');

    const time = new Date(evt.timestamp);
    const timeStr = `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;

    let detail = '';
    if (evt.event_type === 'step_view') {
      detail = `Step ${(evt.step_index || 0) + 1} を表示`;
    } else if (evt.event_type === 'click') {
      const d = evt.data || {};
      detail = `Step ${(evt.step_index || 0) + 1} (${(d.x * 100).toFixed(0)}%, ${(d.y * 100).toFixed(0)}%)`;
    } else if (evt.event_type === 'dwell') {
      const d = evt.data || {};
      detail = `Step ${(evt.step_index || 0) + 1} に ${(d.duration_ms / 1000).toFixed(1)}秒 滞在`;
    } else if (evt.event_type === 'cta_click') {
      detail = `Step ${(evt.step_index || 0) + 1} でCTAをクリック`;
    }

    item.innerHTML = `
      <div class="event-type">${eventLabels[evt.event_type] || evt.event_type} <span style="color:var(--text-muted);font-weight:400">${timeStr}</span></div>
      <div class="event-detail">${detail}</div>
    `;

    timeline.appendChild(item);
  });

  container.appendChild(timeline);
}
