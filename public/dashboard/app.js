// ダッシュボード メインアプリケーション
const API = '';

let currentLpId = null;
let currentLpConfig = null;
let currentTab = 'overview';
let pollTimer = null;
let heatmapRenderer = null;
let dateRange = 'all'; // all, today, 7d, 30d, custom

// 期間フィルターのクエリパラメータ生成
function getDateQuery() {
  const now = new Date();
  let from = null, to = null;

  switch (dateRange) {
    case 'today':
      from = now.toISOString().split('T')[0];
      to = from;
      break;
    case '7d':
      to = now.toISOString().split('T')[0];
      from = new Date(now - 7 * 86400000).toISOString().split('T')[0];
      break;
    case '30d':
      to = now.toISOString().split('T')[0];
      from = new Date(now - 30 * 86400000).toISOString().split('T')[0];
      break;
    case 'custom':
      from = document.getElementById('dateFrom').value || null;
      to = document.getElementById('dateTo').value || null;
      break;
  }

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return params.toString() ? '&' + params.toString() : '';
}

function getPeriodLabel() {
  switch (dateRange) {
    case 'today': return '今日';
    case '7d': return '過去7日間';
    case '30d': return '過去30日間';
    case 'custom': {
      const f = document.getElementById('dateFrom').value;
      const t = document.getElementById('dateTo').value;
      return (f && t) ? `${f} 〜 ${t}` : '期間指定';
    }
    default: return '全期間';
  }
}

// 初期化
async function init() {
  await loadLpList();
  setupTabs();
  setupDateFilter();
  startPolling();
}

// 期間フィルター初期化
function setupDateFilter() {
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      dateRange = btn.dataset.range;

      const customEl = document.getElementById('dateCustom');
      customEl.style.display = dateRange === 'custom' ? 'flex' : 'none';

      if (dateRange !== 'custom') loadTabData();
    });
  });

  // カスタム日付変更
  document.getElementById('dateFrom').addEventListener('change', () => loadTabData());
  document.getElementById('dateTo').addEventListener('change', () => loadTabData());
}

// LP一覧読み込み (preserveSelection: true で現在選択中のLPを維持)
let lpListChangeListenerAdded = false;
let allLps = [];

async function loadLpList(preserveSelection = false) {
  const res = await fetch(`${API}/api/lps`);
  const lps = await res.json();
  allLps = lps;

  const select = document.getElementById('lpSelect');
  select.innerHTML = '';
  lps.forEach(lp => {
    const opt = document.createElement('option');
    opt.value = lp.id;
    opt.textContent = lp.name;
    select.appendChild(opt);
  });

  if (preserveSelection && currentLpId) {
    select.value = currentLpId;
  } else if (lps.length > 0) {
    currentLpId = lps[0].id;
    await loadLpDetail(currentLpId);
    loadTabData();
  }

  // カスタムドロップダウンのラベル更新
  updateLpComboLabel();

  if (lpListChangeListenerAdded) return;
  lpListChangeListenerAdded = true;
  select.addEventListener('change', async () => {
    currentLpId = select.value;
    showMetricsLoading();
    await loadLpDetail(currentLpId);
    loadTabData();
  });
  initLpCombo();
}

// ===== 検索可能カスタムドロップダウン =====
function initLpCombo() {
  const combo = document.getElementById('lpCombo');
  const trigger = document.getElementById('lpComboTrigger');
  const panel = document.getElementById('lpComboPanel');
  const search = document.getElementById('lpComboSearch');
  if (!combo || !trigger || !search) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (combo.classList.contains('open')) {
      closeLpCombo();
    } else {
      openLpCombo();
    }
  });

  search.addEventListener('input', () => renderLpComboList(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLpCombo();
  });

  document.addEventListener('click', (e) => {
    if (!combo.contains(e.target)) closeLpCombo();
  });
}

function openLpCombo() {
  const combo = document.getElementById('lpCombo');
  const search = document.getElementById('lpComboSearch');
  combo.classList.add('open');
  renderLpComboList('');
  setTimeout(() => search.focus(), 30);
}

function closeLpCombo() {
  const combo = document.getElementById('lpCombo');
  const search = document.getElementById('lpComboSearch');
  combo.classList.remove('open');
  search.value = '';
}

// 検索用正規化: ひらがな→カタカナ・全角→半角・小文字化・スペース除去
function normalizeForSearch(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    // ひらがな → カタカナ
    .replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    // 全角英数記号 → 半角
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 全角スペース → 半角
    .replace(/　/g, ' ')
    .replace(/\s+/g, '');
}

// ローマ字 (英単語含む) → ひらがな近似変換
// 例: "nexus" → "ねくす", "grace" → "ぐらせ", "alice" → "ありせ"
// 英単語の発音には完全対応できないが、よくあるLP名の検索に十分実用的
function romajiToHira(s) {
  if (!s) return '';
  s = s.toLowerCase()
    // 英単語特有の表記 → ローマ字ライク
    .replace(/x/g, 'ks')                  // x → ks (nexus → neksus)
    .replace(/c([eiy])/g, 's$1')          // ce, ci, cy → se, si, sy
    .replace(/c([aou])/g, 'k$1')          // ca, co, cu → ka, ko, ku
    .replace(/c/g, 'k')                   // 残りの c → k
    .replace(/qu/g, 'ku')
    .replace(/q/g, 'k')
    .replace(/l/g, 'r')                   // l → r
    .replace(/v/g, 'b')                   // v → b
    .replace(/f([^u])/g, 'h$1')           // f → h (fuだけは残す)
    .replace(/th/g, 's')                  // th → s
    .replace(/wh/g, 'h')
    .replace(/[^a-zぁ-んァ-ヶー]/g, '');  // 英数字とかな以外を除去

  // ローマ字 → ひらがな (3文字, 2文字, 1文字の順で最長一致)
  const map3 = {
    'kya':'きゃ','kyu':'きゅ','kyo':'きょ',
    'sha':'しゃ','shu':'しゅ','sho':'しょ','shi':'し',
    'cha':'ちゃ','chu':'ちゅ','cho':'ちょ','chi':'ち',
    'tsu':'つ',
    'nya':'にゃ','nyu':'にゅ','nyo':'にょ',
    'hya':'ひゃ','hyu':'ひゅ','hyo':'ひょ',
    'mya':'みゃ','myu':'みゅ','myo':'みょ',
    'rya':'りゃ','ryu':'りゅ','ryo':'りょ',
    'gya':'ぎゃ','gyu':'ぎゅ','gyo':'ぎょ',
    'bya':'びゃ','byu':'びゅ','byo':'びょ',
    'pya':'ぴゃ','pyu':'ぴゅ','pyo':'ぴょ',
  };
  const map2 = {
    'ka':'か','ki':'き','ku':'く','ke':'け','ko':'こ',
    'sa':'さ','su':'す','se':'せ','so':'そ',
    'ta':'た','te':'て','to':'と',
    'na':'な','ni':'に','nu':'ぬ','ne':'ね','no':'の',
    'ha':'は','hi':'ひ','hu':'ふ','fu':'ふ','he':'へ','ho':'ほ',
    'ma':'ま','mi':'み','mu':'む','me':'め','mo':'も',
    'ya':'や','yu':'ゆ','yo':'よ',
    'ra':'ら','ri':'り','ru':'る','re':'れ','ro':'ろ',
    'wa':'わ','wo':'を',
    'ga':'が','gi':'ぎ','gu':'ぐ','ge':'げ','go':'ご',
    'za':'ざ','zi':'じ','ji':'じ','zu':'ず','ze':'ぜ','zo':'ぞ',
    'da':'だ','de':'で','do':'ど',
    'ba':'ば','bi':'び','bu':'ぶ','be':'べ','bo':'ぼ',
    'pa':'ぱ','pi':'ぴ','pu':'ぷ','pe':'ぺ','po':'ぽ',
    'ja':'じゃ','ju':'じゅ','jo':'じょ',
  };
  const map1 = {
    'a':'あ','i':'い','u':'う','e':'え','o':'お','n':'ん',
  };

  let out = '';
  let i = 0;
  while (i < s.length) {
    const c3 = s.substr(i, 3);
    if (map3[c3]) { out += map3[c3]; i += 3; continue; }
    const c2 = s.substr(i, 2);
    if (map2[c2]) { out += map2[c2]; i += 2; continue; }
    const c1 = s[i];
    if (map1[c1]) { out += map1[c1]; i += 1; continue; }
    // 既にひらがな/カタカナの場合はそのまま
    if (/[ぁ-んァ-ヶー]/.test(c1)) { out += c1; i += 1; continue; }
    // それ以外は元のまま (検索キーに残す)
    out += c1;
    i += 1;
  }
  // 最後にカタカナに統一
  return out.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

// 検索対象の全表現を返す (LP1つにつき複数のキー候補)
function buildSearchKeys(text) {
  const norm = normalizeForSearch(text);
  const hira = romajiToHira(text);
  // norm: アリス, ALICE; hira: norm のローマ字部分をかな化
  return norm + '|' + hira;
}

function renderLpComboList(query) {
  const list = document.getElementById('lpComboList');
  const nq = normalizeForSearch(query);
  // クエリ側もローマ字版を生成 (ユーザーがローマ字で打った場合 = そのまま、ひらがな = カナ化済み)
  const hq = romajiToHira(query);
  const queries = [nq, hq].filter(Boolean);

  const filtered = nq ? allLps.filter(lp => {
    // 各LPの検索キー: name + slug の正規化版 + ローマ字→ひらがな変換版
    const haystack = buildSearchKeys(lp.name) + '|' + buildSearchKeys(lp.slug);
    return queries.some(q => haystack.includes(q));
  }) : allLps;

  if (filtered.length === 0) {
    list.innerHTML = '<li class="no-result">該当するLPがありません</li>';
    return;
  }

  list.innerHTML = filtered.map(lp =>
    `<li data-id="${lp.id}" class="${lp.id === currentLpId ? 'selected' : ''}">${escapeHtml(lp.name)}<span style="margin-left:auto;font-size:11px;color:var(--text-muted);opacity:0.6;">/${escapeHtml(lp.slug || '')}</span></li>`
  ).join('');

  list.querySelectorAll('li[data-id]').forEach(li => {
    li.addEventListener('click', async () => {
      currentLpId = li.dataset.id;
      const select = document.getElementById('lpSelect');
      if (select) select.value = currentLpId;
      updateLpComboLabel();
      closeLpCombo();
      showMetricsLoading();
      await loadLpDetail(currentLpId);
      loadTabData();
    });
  });
}

function updateLpComboLabel() {
  const label = document.getElementById('lpComboLabel');
  if (!label || !currentLpId) return;
  const lp = allLps.find(l => l.id === currentLpId);
  if (lp) label.textContent = lp.name;
}

// メトリクス値をローディング状態に
function showMetricsLoading() {
  ['metricSessions', 'metricCta', 'metricCvr', 'metricSteps', 'metricDuration', 'metricBounce'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '…';
      el.classList.add('loading');
    }
  });
}

function clearMetricsLoading() {
  ['metricSessions', 'metricCta', 'metricCvr', 'metricSteps', 'metricDuration', 'metricBounce'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('loading');
  });
}

async function loadLpDetail(lpId) {
  const res = await fetch(`${API}/api/lps/${lpId}`);
  const lp = await res.json();
  currentLpConfig = lp.config;

  // LP名更新
  document.getElementById('lpName').textContent = lp.name;
  document.getElementById('lpLink').href = `/lp/${lp.slug}`;
  document.getElementById('lpLink').textContent = `/lp/${lp.slug}`;

  // 監視ボタンの状態
  updateNotifyButtonState(lp.notify_enabled === 1);
}

// タブ制御
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;

      // タブコンテンツの表示切替
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.getElementById(`tab-${currentTab}`).classList.add('active');

      loadTabData();
    });
  });
}

// タブデータ読み込み
async function loadTabData() {
  if (!currentLpId) return;

  switch (currentTab) {
    case 'overview': await loadOverview(); break;
    case 'steps': await loadSteps(); break;
    case 'heatmap': await loadHeatmap(); break;
    case 'funnel': await loadFunnel(); break;
    case 'sessions': await loadSessions(); break;
    case 'attribution': await loadAttribution(); break;
    case 'submissions': await loadSubmissions(); break;
  }

  updateTimestamp();
}

// 概要タブ
async function loadOverview() {
  showMetricsLoading();
  const dq = getDateQuery();
  const res = await fetch(`${API}/api/analytics/${currentLpId}/overview?_=1${dq}`);
  const data = await res.json();

  document.getElementById('metricSessions').textContent = data.totalSessions.toLocaleString();
  document.getElementById('metricCta').textContent = data.totalCtaClicks.toLocaleString();
  document.getElementById('metricCvr').textContent = data.conversionRate + '%';
  document.getElementById('metricSteps').textContent = data.avgStepsViewed;
  document.getElementById('metricDuration').textContent = (data.avgSessionDuration / 1000).toFixed(1) + '秒';
  document.getElementById('metricBounce').textContent = data.bounceRate + '%';
  document.getElementById('metricPeriod').textContent = getPeriodLabel();
  clearMetricsLoading();

  // CVR評価 (高いほど良い)
  const cvr = data.conversionRate;
  const cvrEl = document.getElementById('metricCvr');
  const cvrEval = document.getElementById('metricCvrEval');
  if (cvr >= 8) {
    cvrEl.className = 'value success';
    cvrEval.className = 'metric-eval excellent';
    cvrEval.textContent = '優秀';
  } else if (cvr >= 5) {
    cvrEl.className = 'value success';
    cvrEval.className = 'metric-eval good';
    cvrEval.textContent = '良好';
  } else if (cvr >= 2) {
    cvrEl.className = 'value warning';
    cvrEval.className = 'metric-eval average';
    cvrEval.textContent = '平均';
  } else {
    cvrEl.className = 'value danger';
    cvrEval.className = 'metric-eval poor';
    cvrEval.textContent = '要改善';
  }

  // バウンス率評価 (低いほど良い)
  const bounce = data.bounceRate;
  const bounceEl = document.getElementById('metricBounce');
  const bounceEval = document.getElementById('metricBounceEval');
  if (bounce < 30) {
    bounceEl.className = 'value success';
    bounceEval.className = 'metric-eval excellent';
    bounceEval.textContent = '優秀';
  } else if (bounce < 40) {
    bounceEl.className = 'value success';
    bounceEval.className = 'metric-eval good';
    bounceEval.textContent = '良好';
  } else if (bounce < 60) {
    bounceEl.className = 'value warning';
    bounceEval.className = 'metric-eval average';
    bounceEval.textContent = '平均';
  } else {
    bounceEl.className = 'value danger';
    bounceEval.className = 'metric-eval poor';
    bounceEval.textContent = '要改善';
  }

  // ファネル簡易表示
  const funnelRes = await fetch(`${API}/api/analytics/${currentLpId}/funnel?_=1${dq}`);
  const funnelData = await funnelRes.json();
  renderFunnel(document.getElementById('overviewFunnel'), funnelData);

  // ステップ概要
  const stepsRes = await fetch(`${API}/api/analytics/${currentLpId}/steps?_=1${dq}`);
  const stepsData = await stepsRes.json();
  renderStepTable(document.getElementById('overviewStepTable'), stepsData);
}

// ステップ分析タブ
async function loadSteps() {
  const dq = getDateQuery();
  const stepsRes = await fetch(`${API}/api/analytics/${currentLpId}/steps?_=1${dq}`);
  const stepsData = await stepsRes.json();
  renderStepTable(document.getElementById('stepsTable'), stepsData);

  const dwellRes = await fetch(`${API}/api/analytics/${currentLpId}/dwell-heatmap?_=1${dq}`);
  const dwellData = await dwellRes.json();
  renderDwellChart(document.getElementById('dwellChart'), dwellData);
}

// ヒートマップタブ
async function loadHeatmap(stepIndex = 0) {
  const dq = getDateQuery();
  // ステップ選択リスト構築
  const stepsRes = await fetch(`${API}/api/analytics/${currentLpId}/steps?_=1${dq}`);
  const stepsData = await stepsRes.json();

  const listEl = document.getElementById('heatmapStepList');
  listEl.innerHTML = '';

  // ステップサムネイルをサイドバーに表示
  stepsData.steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.className = i === stepIndex ? 'active' : '';
    const imgUrl = currentLpConfig?.steps?.[i]?.image || '';
    li.innerHTML = `
      ${imgUrl ? `<img src="${imgUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;flex-shrink:0;">` : ''}
      <span>Step ${step.stepIndex + 1}</span>
      <span class="click-count">${step.clickCount}回</span>
    `;
    li.addEventListener('click', () => loadHeatmap(i));
    listEl.appendChild(li);
  });

  // LP画像を背景に表示
  const bgImage = document.getElementById('heatmapBgImage');
  const stepImageUrl = currentLpConfig?.steps?.[stepIndex]?.image || '';
  if (stepImageUrl) {
    bgImage.src = stepImageUrl;
    bgImage.style.display = 'block';
  } else {
    bgImage.style.display = 'none';
  }

  // ヒートマップ描画
  const heatRes = await fetch(`${API}/api/analytics/${currentLpId}/heatmap/${stepIndex}?_=1${dq}`);
  const heatData = await heatRes.json();

  const canvas = document.getElementById('heatmapCanvas');
  if (!heatmapRenderer) {
    heatmapRenderer = new HeatmapRenderer(canvas);
  }

  // 画像があれば透明背景、なければグラデーション
  const bgGradient = stepImageUrl ? null : (currentLpConfig?.steps?.[stepIndex]?.bgGradient || null);
  heatmapRenderer.render(heatData.clicks, stepImageUrl ? '__transparent__' : bgGradient);

  document.getElementById('heatmapTotalClicks').textContent = `総クリック数: ${heatData.totalClicks}`;
}

// ファネルタブ
async function loadFunnel() {
  const dq = getDateQuery();
  const res = await fetch(`${API}/api/analytics/${currentLpId}/funnel?_=1${dq}`);
  const data = await res.json();
  renderFunnel(document.getElementById('funnelChart'), data);
}

// セッションタブ
async function loadSessions() {
  const dq = getDateQuery();
  const res = await fetch(`${API}/api/analytics/${currentLpId}/sessions?limit=50${dq}`);
  const data = await res.json();

  document.getElementById('sessionTotal').textContent = `${data.total}件中 ${data.sessions.length}件表示`;
  renderSessionList(document.getElementById('sessionListContainer'), data, showSessionDetail);
}

// 流入元分析タブ
async function loadAttribution() {
  const dq = getDateQuery();
  const dim = document.getElementById('attributionDimension').value;
  const res = await fetch(`${API}/api/analytics/${currentLpId}/attribution?dimension=${dim}${dq}`);
  const rows = await res.json();

  const container = document.getElementById('attributionTable');
  if (!rows.length) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:24px;text-align:center;">データがありません。UTMパラメータ付きのURLからアクセスがあると表示されます。</p>';
    return;
  }

  const maxSessions = Math.max(...rows.map(r => r.sessions));
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="border-bottom:1px solid var(--border);color:var(--text-muted);">
          <th style="padding:10px 12px;text-align:left;">流入元</th>
          <th style="padding:10px 12px;text-align:right;">セッション</th>
          <th style="padding:10px 12px;text-align:left;min-width:120px;"></th>
          <th style="padding:10px 12px;text-align:right;">CTAクリック</th>
          <th style="padding:10px 12px;text-align:right;">CVR</th>
          <th style="padding:10px 12px;text-align:right;">平均到達ステップ</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:10px 12px;font-weight:600;">${r.label}</td>
            <td style="padding:10px 12px;text-align:right;">${r.sessions}</td>
            <td style="padding:10px 12px;">
              <div style="height:6px;background:var(--surface2);border-radius:3px;">
                <div style="height:100%;width:${Math.round(r.sessions/maxSessions*100)}%;background:var(--accent);border-radius:3px;"></div>
              </div>
            </td>
            <td style="padding:10px 12px;text-align:right;">${r.ctaClicks}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:700;color:${r.cvr >= 5 ? 'var(--success)' : r.cvr >= 2 ? 'var(--accent)' : 'var(--text-muted)'};">${r.cvr}%</td>
            <td style="padding:10px 12px;text-align:right;">${r.avgStep}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// セッション詳細モーダル
async function showSessionDetail(sessionId) {
  const res = await fetch(`${API}/api/analytics/sessions/${sessionId}`);
  const data = await res.json();

  document.getElementById('sessionDetailTitle').textContent =
    `セッション詳細 (${data.session.viewport_width}x${data.session.viewport_height})`;

  renderSessionTimeline(document.getElementById('sessionTimeline'), data);

  const modal = document.getElementById('sessionModal');
  modal.classList.add('visible');
}

function closeSessionModal() {
  document.getElementById('sessionModal').classList.remove('visible');
}

// ポーリング
function startPolling() {
  pollTimer = setInterval(() => {
    if (currentTab === 'overview') loadOverview();
  }, 30000);
}

// 更新タイムスタンプ
function updateTimestamp() {
  const now = new Date();
  const str = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  document.getElementById('lastUpdated').textContent = `最終更新: ${str}`;
}

// リフレッシュボタン
function refreshData() {
  loadTabData();
}

// ===== LP作成機能 =====
let createDirection = 'vertical';
let createSteps = [];

function openCreateLP() {
  createDirection = 'vertical';
  createSteps = [
    { title: '', description: '', image: null, imageUrl: '', bgGradient: '', textColor: '#ffffff' }
  ];
  document.getElementById('createName').value = '';
  document.getElementById('createSlug').value = '';
  document.getElementById('createCtaText').value = '';
  document.getElementById('createCtaUrl').value = '';
  document.getElementById('createCtaColor').value = 'line-green';
  document.getElementById('createCtaColorCustom').value = '#06C755';
  document.getElementById('createCtaCustomRow').style.display = 'none';
  document.getElementById('createCtaMicrocopy').value = '';
  document.getElementById('createCtaShowFinalLarge').checked = true;
  document.getElementById('createCtaActionType').value = 'url';
  document.getElementById('createFormFieldsBox').style.display = 'none';
  document.getElementById('createFormShowName').checked = true;
  document.getElementById('createFormShowPhone').checked = true;
  document.getElementById('createFormShowLineId').checked = false;
  document.getElementById('createFormShowEmail').checked = false;
  document.getElementById('createFormShowMessage').checked = true;
  document.getElementById('createFormShowArea').checked = false;
  document.getElementById('createAreaConfig').style.display = 'none';
  document.getElementById('createFormAreaLabel').value = '';
  document.getElementById('createFormAreaPlaceholder').value = '';
  document.getElementById('createFormSubmitLabel').value = '';
  document.getElementById('createFormSuccessMessage').value = '';
  document.getElementById('createFormNotifyEmail').value = '';
  document.getElementById('createPixelMeta').value = '';
  document.getElementById('createPixelTiktok').value = '';
  document.getElementById('createPixelGoogle').value = '';
  document.getElementById('createPixelGoogleLabel').value = '';
  document.getElementById('createPixelGtm').value = '';
  document.getElementById('createPixelLine').value = '';
  renderStepsEditor();
  document.getElementById('createLpModal').classList.add('visible');
}

function toggleCreateCtaCustom() {
  const sel = document.getElementById('createCtaColor').value;
  document.getElementById('createCtaCustomRow').style.display = sel === 'custom' ? '' : 'none';
}

function toggleEditCtaCustom() {
  const sel = document.getElementById('editCtaColor').value;
  document.getElementById('editCtaCustomRow').style.display = sel === 'custom' ? '' : 'none';
}

function toggleCreateFormSection() {
  const sel = document.getElementById('createCtaActionType').value;
  document.getElementById('createFormFieldsBox').style.display = sel === 'url' ? 'none' : '';
}

function toggleEditFormSection() {
  const sel = document.getElementById('editCtaActionType').value;
  document.getElementById('editFormFieldsBox').style.display = sel === 'url' ? 'none' : '';
}

function toggleCreateAreaConfig() {
  const checked = document.getElementById('createFormShowArea').checked;
  document.getElementById('createAreaConfig').style.display = checked ? '' : 'none';
}

function toggleEditAreaConfig() {
  const checked = document.getElementById('editFormShowArea').checked;
  document.getElementById('editAreaConfig').style.display = checked ? '' : 'none';
}

function closeCreateLP() {
  document.getElementById('createLpModal').classList.remove('visible');
}

function setDirection(dir) {
  createDirection = dir;
  document.querySelectorAll('.dir-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
}

function addStep() {
  createSteps.push({ title: '', description: '', image: null, imageUrl: '', bgGradient: '', textColor: '#ffffff' });
  renderStepsEditor();
}

function removeStep(index) {
  if (createSteps.length <= 1) return;
  createSteps.splice(index, 1);
  renderStepsEditor();
}

function renderStepsEditor() {
  const container = document.getElementById('stepsEditor');
  container.innerHTML = '';

  createSteps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'step-editor-item';
    div.innerHTML = `
      <span class="step-num">Step ${i + 1}</span>
      ${createSteps.length > 1 ? `<button class="step-remove" onclick="removeStep(${i})">&times;</button>` : ''}
      <div style="margin-top:8px;">
        <div class="form-row">
          <label>画像</label>
          <div class="image-upload-area" id="upload-area-${i}">
            ${step.imageUrl
              ? `<img src="${step.imageUrl}" alt="step ${i + 1}">`
              : `<div class="upload-text">クリックまたはドロップで画像をアップロード<small>推奨: 1080x1920px (スマホ全画面) / JPG, PNG, WebP</small></div>`
            }
            <input type="file" accept="image/*" onchange="handleImageUpload(${i}, this)">
          </div>
        </div>
        <div class="form-row">
          <label>タイトル (画像上に表示、任意)</label>
          <input type="text" value="${escapeHtml(step.title)}" onchange="createSteps[${i}].title=this.value" placeholder="例：今だけ限定キャンペーン">
        </div>
        <div class="form-row">
          <label>説明文 (任意)</label>
          <textarea onchange="createSteps[${i}].description=this.value" placeholder="例：期間限定で30%OFF">${escapeHtml(step.description)}</textarea>
        </div>
        <div style="display:flex;gap:12px;">
          <div class="form-row" style="flex:1;">
            <label>テキスト色</label>
            <input type="color" value="${step.textColor}" onchange="createSteps[${i}].textColor=this.value" style="width:48px;height:36px;padding:2px;">
          </div>
          <div class="form-row" style="flex:2;">
            <label>背景色 (画像なしの場合)</label>
            <input type="text" value="${escapeHtml(step.bgGradient)}" onchange="createSteps[${i}].bgGradient=this.value" placeholder="linear-gradient(135deg, #667eea, #764ba2)">
          </div>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function handleImageUpload(stepIndex, input) {
  const file = input.files[0];
  if (!file) return;

  const area = document.getElementById(`upload-area-${stepIndex}`);

  // プレビュー表示
  const reader = new FileReader();
  reader.onload = (e) => {
    area.querySelector('.upload-text')?.remove();
    let img = area.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      area.insertBefore(img, area.firstChild);
    }
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);

  // サーバーにアップロード
  try {
    const res = await fetch('/api/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file
    });
    const data = await res.json();
    if (data.url) {
      createSteps[stepIndex].imageUrl = data.url;
      createSteps[stepIndex].image = data.url;
    }
  } catch (e) {
    alert('画像アップロードに失敗しました');
  }
}

async function submitCreateLP() {
  const name = document.getElementById('createName').value.trim();
  const slug = document.getElementById('createSlug').value.trim();
  const ctaText = document.getElementById('createCtaText').value.trim();
  const ctaUrl = document.getElementById('createCtaUrl').value.trim();

  if (!name) return alert('LP名を入力してください');
  if (!slug) return alert('スラッグを入力してください');
  if (!/^[a-z0-9-]+$/.test(slug)) return alert('スラッグは半角英数字とハイフンのみ使用できます');

  const steps = createSteps.map(s => ({
    title: s.title || '',
    description: s.description || '',
    image: s.imageUrl || '',
    bgGradient: s.bgGradient || 'linear-gradient(135deg, #667eea, #764ba2)',
    textColor: s.textColor || '#ffffff'
  }));

  // ピクセル設定を収集
  const pixels = {};
  const metaId = document.getElementById('createPixelMeta').value.trim();
  const tiktokId = document.getElementById('createPixelTiktok').value.trim();
  const googleId = document.getElementById('createPixelGoogle').value.trim();
  const googleLabel = document.getElementById('createPixelGoogleLabel').value.trim();
  const gtmId = document.getElementById('createPixelGtm').value.trim();
  const lineId = document.getElementById('createPixelLine').value.trim();
  if (metaId) pixels.meta = metaId;
  if (tiktokId) pixels.tiktok = tiktokId;
  if (googleId) pixels.google = googleId;
  if (googleLabel) pixels.googleConversionLabel = googleLabel;
  if (gtmId) pixels.gtm = gtmId;
  if (lineId) pixels.line = lineId;

  const ctaColor = document.getElementById('createCtaColor').value;
  const ctaColorCustom = ctaColor === 'custom' ? document.getElementById('createCtaColorCustom').value : null;
  const ctaMicrocopy = document.getElementById('createCtaMicrocopy').value.trim();
  const ctaShowFinalLarge = document.getElementById('createCtaShowFinalLarge').checked;
  const ctaActionType = document.getElementById('createCtaActionType').value;

  try {
    const res = await fetch('/api/lps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        slug,
        config: { direction: createDirection, steps, pixels },
        cta_text: ctaText || 'お問い合わせ',
        cta_url: ctaUrl || '#',
        cta_color: ctaColor,
        cta_color_custom: ctaColorCustom,
        cta_microcopy: ctaMicrocopy || null,
        cta_show_final_large: ctaShowFinalLarge,
        cta_action_type: ctaActionType,
        form_show_name: document.getElementById('createFormShowName').checked,
        form_show_phone: document.getElementById('createFormShowPhone').checked,
        form_show_line_id: document.getElementById('createFormShowLineId').checked,
        form_show_email: document.getElementById('createFormShowEmail').checked,
        form_show_message: document.getElementById('createFormShowMessage').checked,
        form_show_area: document.getElementById('createFormShowArea').checked,
        form_area_label: document.getElementById('createFormAreaLabel').value.trim() || null,
        form_area_placeholder: document.getElementById('createFormAreaPlaceholder').value.trim() || null,
        form_submit_label: document.getElementById('createFormSubmitLabel').value.trim() || null,
        form_success_message: document.getElementById('createFormSuccessMessage').value.trim() || null,
        form_notify_email: document.getElementById('createFormNotifyEmail').value.trim() || null
      })
    });
    const data = await res.json();

    if (data.error) {
      alert(data.error);
      return;
    }

    closeCreateLP();
    // 作成したLPを選択 (loadLpListより前にcurrentLpIdをセット)
    currentLpId = data.id;
    await loadLpList(true);
    await loadLpDetail(data.id);
    loadTabData();

    alert(`LP作成完了！\nURL: ${location.origin}/lp/${slug}`);
  } catch (e) {
    alert('LP作成に失敗しました: ' + e.message);
  }
}

// ===== LP編集機能 =====
let editDirection = 'vertical';
let editSteps = [];
let editLpData = null;

async function openEditLP() {
  if (!currentLpId) return alert('LPを選択してください');

  const res = await fetch(`${API}/api/lps/${currentLpId}`);
  editLpData = await res.json();
  const config = editLpData.config;

  document.getElementById('editName').value = editLpData.name;
  document.getElementById('editSlug').value = editLpData.slug || '';
  document.getElementById('editCtaText').value = editLpData.cta_text || '';
  document.getElementById('editCtaUrl').value = editLpData.cta_url || '';

  // CTA カラー & マイクロコピー
  const ctaColor = editLpData.cta_color || 'line-green';
  document.getElementById('editCtaColor').value = ctaColor;
  document.getElementById('editCtaColorCustom').value = editLpData.cta_color_custom || '#06C755';
  document.getElementById('editCtaCustomRow').style.display = ctaColor === 'custom' ? '' : 'none';
  document.getElementById('editCtaMicrocopy').value = editLpData.cta_microcopy || '';
  document.getElementById('editCtaShowFinalLarge').checked = editLpData.cta_show_final_large !== 0;

  // フォーム設定
  const actionType = editLpData.cta_action_type || 'url';
  document.getElementById('editCtaActionType').value = actionType;
  document.getElementById('editFormFieldsBox').style.display = actionType === 'url' ? 'none' : '';
  document.getElementById('editFormShowName').checked = editLpData.form_show_name !== 0;
  document.getElementById('editFormShowPhone').checked = editLpData.form_show_phone !== 0;
  document.getElementById('editFormShowLineId').checked = editLpData.form_show_line_id === 1;
  document.getElementById('editFormShowEmail').checked = editLpData.form_show_email === 1;
  document.getElementById('editFormShowMessage').checked = editLpData.form_show_message !== 0;
  document.getElementById('editFormShowArea').checked = editLpData.form_show_area === 1;
  document.getElementById('editAreaConfig').style.display = editLpData.form_show_area === 1 ? '' : 'none';
  document.getElementById('editFormAreaLabel').value = editLpData.form_area_label || '';
  document.getElementById('editFormAreaPlaceholder').value = editLpData.form_area_placeholder || '';
  document.getElementById('editFormSubmitLabel').value = editLpData.form_submit_label || '';
  document.getElementById('editFormSuccessMessage').value = editLpData.form_success_message || '';
  document.getElementById('editFormNotifyEmail').value = editLpData.form_notify_email || '';

  // ピクセル
  const pixels = config.pixels || {};
  document.getElementById('editPixelMeta').value = pixels.meta || '';
  document.getElementById('editPixelTiktok').value = pixels.tiktok || '';
  document.getElementById('editPixelGoogle').value = pixels.google || '';
  document.getElementById('editPixelGoogleLabel').value = pixels.googleConversionLabel || '';
  document.getElementById('editPixelGtm').value = pixels.gtm || '';
  document.getElementById('editPixelLine').value = pixels.line || '';

  // 方向
  editDirection = config.direction || 'vertical';
  document.querySelectorAll('#editLpModal .dir-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dir === editDirection);
  });

  // ステップ
  editSteps = (config.steps || []).map(s => ({
    title: s.title || '',
    description: s.description || '',
    imageUrl: s.image || '',
    bgGradient: s.bgGradient || '',
    textColor: s.textColor || '#ffffff'
  }));
  if (editSteps.length === 0) {
    editSteps = [{ title: '', description: '', imageUrl: '', bgGradient: '', textColor: '#ffffff' }];
  }
  renderEditStepsEditor();

  document.getElementById('editLpModal').classList.add('visible');
}

function closeEditLP() {
  document.getElementById('editLpModal').classList.remove('visible');
}

function setEditDirection(dir) {
  editDirection = dir;
  document.querySelectorAll('#editLpModal .dir-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
}

function addEditStep() {
  editSteps.push({ title: '', description: '', imageUrl: '', bgGradient: '', textColor: '#ffffff' });
  renderEditStepsEditor();
}

function removeEditStep(index) {
  if (editSteps.length <= 1) return;
  editSteps.splice(index, 1);
  renderEditStepsEditor();
}

function renderEditStepsEditor() {
  const container = document.getElementById('editStepsEditor');
  container.innerHTML = '';

  editSteps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'step-editor-item';
    div.innerHTML = `
      <span class="step-num">Step ${i + 1}</span>
      ${editSteps.length > 1 ? `<button class="step-remove" onclick="removeEditStep(${i})">&times;</button>` : ''}
      <div style="margin-top:8px;">
        <div class="form-row">
          <label>画像</label>
          <div class="image-upload-area" id="edit-upload-area-${i}">
            ${step.imageUrl
              ? `<img src="${step.imageUrl}" alt="step ${i + 1}">`
              : `<div class="upload-text">クリックまたはドロップで画像をアップロード<small>推奨: 1080x1920px (スマホ全画面) / JPG, PNG, WebP</small></div>`
            }
            <input type="file" accept="image/*" onchange="handleEditImageUpload(${i}, this)">
          </div>
        </div>
        <div class="form-row">
          <label>タイトル (画像上に表示、任意)</label>
          <input type="text" value="${escapeHtml(step.title)}" onchange="editSteps[${i}].title=this.value">
        </div>
        <div class="form-row">
          <label>説明文 (任意)</label>
          <textarea onchange="editSteps[${i}].description=this.value">${escapeHtml(step.description)}</textarea>
        </div>
        <div style="display:flex;gap:12px;">
          <div class="form-row" style="flex:1;">
            <label>テキスト色</label>
            <input type="color" value="${step.textColor}" onchange="editSteps[${i}].textColor=this.value" style="width:48px;height:36px;padding:2px;">
          </div>
          <div class="form-row" style="flex:2;">
            <label>背景色 (画像なしの場合)</label>
            <input type="text" value="${escapeHtml(step.bgGradient)}" onchange="editSteps[${i}].bgGradient=this.value" placeholder="linear-gradient(135deg, #667eea, #764ba2)">
          </div>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

async function handleEditImageUpload(stepIndex, input) {
  const file = input.files[0];
  if (!file) return;

  const area = document.getElementById(`edit-upload-area-${stepIndex}`);
  const reader = new FileReader();
  reader.onload = (e) => {
    area.querySelector('.upload-text')?.remove();
    let img = area.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      area.insertBefore(img, area.firstChild);
    }
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);

  try {
    const res = await fetch('/api/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file
    });
    const data = await res.json();
    if (data.url) {
      editSteps[stepIndex].imageUrl = data.url;
    }
  } catch (e) {
    alert('画像アップロードに失敗しました');
  }
}

async function submitEditLP() {
  const name = document.getElementById('editName').value.trim();
  const slug = document.getElementById('editSlug').value.trim();
  const ctaText = document.getElementById('editCtaText').value.trim();
  const ctaUrl = document.getElementById('editCtaUrl').value.trim();

  if (!name) return alert('LP名を入力してください');
  if (!slug) return alert('スラッグを入力してください');
  if (!/^[a-z0-9-]+$/.test(slug)) return alert('スラッグは半角英数字とハイフンのみ使用できます');

  // スラッグ変更時は警告
  if (slug !== editLpData.slug) {
    const confirmed = confirm(`スラッグを「${editLpData.slug}」→「${slug}」に変更します。\n\n旧URL（/lp/${editLpData.slug}）は404になります。配信中の広告URLが旧スラッグの場合、必ず差し替えてください。\n\n続行しますか？`);
    if (!confirmed) return;
  }

  const steps = editSteps.map(s => ({
    title: s.title || '',
    description: s.description || '',
    image: s.imageUrl || '',
    bgGradient: s.bgGradient || 'linear-gradient(135deg, #667eea, #764ba2)',
    textColor: s.textColor || '#ffffff'
  }));

  const pixels = {};
  const metaId = document.getElementById('editPixelMeta').value.trim();
  const tiktokId = document.getElementById('editPixelTiktok').value.trim();
  const googleId = document.getElementById('editPixelGoogle').value.trim();
  const googleLabel = document.getElementById('editPixelGoogleLabel').value.trim();
  const gtmId = document.getElementById('editPixelGtm').value.trim();
  const lineId = document.getElementById('editPixelLine').value.trim();
  if (metaId) pixels.meta = metaId;
  if (tiktokId) pixels.tiktok = tiktokId;
  if (googleId) pixels.google = googleId;
  if (googleLabel) pixels.googleConversionLabel = googleLabel;
  if (gtmId) pixels.gtm = gtmId;
  if (lineId) pixels.line = lineId;

  // 編集中のLPを保持
  const savedId = currentLpId;

  const ctaColor = document.getElementById('editCtaColor').value;
  const ctaColorCustom = ctaColor === 'custom' ? document.getElementById('editCtaColorCustom').value : null;
  const ctaMicrocopy = document.getElementById('editCtaMicrocopy').value.trim();
  const ctaShowFinalLarge = document.getElementById('editCtaShowFinalLarge').checked;
  const ctaActionType = document.getElementById('editCtaActionType').value;

  try {
    const res = await fetch(`/api/lps/${currentLpId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        slug,
        config: { direction: editDirection, steps, pixels },
        cta_text: ctaText || 'お問い合わせ',
        cta_url: ctaUrl || '#',
        cta_color: ctaColor,
        cta_color_custom: ctaColorCustom,
        cta_microcopy: ctaMicrocopy || null,
        cta_show_final_large: ctaShowFinalLarge,
        cta_action_type: ctaActionType,
        form_show_name: document.getElementById('editFormShowName').checked,
        form_show_phone: document.getElementById('editFormShowPhone').checked,
        form_show_line_id: document.getElementById('editFormShowLineId').checked,
        form_show_email: document.getElementById('editFormShowEmail').checked,
        form_show_message: document.getElementById('editFormShowMessage').checked,
        form_show_area: document.getElementById('editFormShowArea').checked,
        form_area_label: document.getElementById('editFormAreaLabel').value.trim() || null,
        form_area_placeholder: document.getElementById('editFormAreaPlaceholder').value.trim() || null,
        form_submit_label: document.getElementById('editFormSubmitLabel').value.trim() || null,
        form_success_message: document.getElementById('editFormSuccessMessage').value.trim() || null,
        form_notify_email: document.getElementById('editFormNotifyEmail').value.trim() || null
      })
    });
    const data = await res.json();
    if (data.error) return alert(data.error);

    closeEditLP();
    await loadLpList(true); // 編集中のLPを維持
    await loadLpDetail(currentLpId);
    loadTabData();
    alert('保存しました');
  } catch (e) {
    alert('保存に失敗しました: ' + e.message);
  }
}

async function deleteLP() {
  if (!confirm('このLPを削除しますか？アナリティクスデータも全て削除されます。')) return;

  try {
    await fetch(`/api/lps/${currentLpId}`, { method: 'DELETE' });
    closeEditLP();
    await loadLpList();
    loadTabData();
    alert('削除しました');
  } catch (e) {
    alert('削除に失敗しました');
  }
}

// ===== 反応低下アラート設定 =====
async function openNotifySettings() {
  if (!currentLpId) return alert('LPを選択してください');
  try {
    const res = await fetch(`${API}/api/lps/${currentLpId}/notify-settings`);
    if (!res.ok) throw new Error('通知設定の取得に失敗しました');
    const s = await res.json();
    document.getElementById('notifyEnabled').checked = s.notify_enabled === 1;
    document.getElementById('notifyCvrThreshold').value = s.notify_cvr_threshold ?? 1.0;
    document.getElementById('notifyMinSessions').value = s.notify_min_sessions ?? 50;
    const box = document.getElementById('notifyLastSentBox');
    if (s.notify_last_sent_at) {
      document.getElementById('notifyLastSent').textContent = new Date(s.notify_last_sent_at).toLocaleString('ja-JP');
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
    document.getElementById('notifyModal').classList.add('visible');
  } catch (e) {
    alert(e.message);
  }
}

function closeNotifySettings() {
  document.getElementById('notifyModal').classList.remove('visible');
}

async function submitNotifySettings() {
  if (!currentLpId) return;
  const payload = {
    notify_enabled: document.getElementById('notifyEnabled').checked,
    notify_cvr_threshold: parseFloat(document.getElementById('notifyCvrThreshold').value),
    notify_min_sessions: parseInt(document.getElementById('notifyMinSessions').value, 10),
  };
  try {
    const res = await fetch(`${API}/api/lps/${currentLpId}/notify-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    closeNotifySettings();
    updateNotifyButtonState(payload.notify_enabled);
    alert('保存しました');
  } catch (e) {
    alert('保存に失敗しました: ' + e.message);
  }
}

function updateNotifyButtonState(enabled) {
  const btn = document.getElementById('notifyBtn');
  if (!btn) return;
  if (enabled) {
    btn.textContent = '🔔 監視中';
    btn.style.background = '#22c55e';
    btn.style.color = '#fff';
    btn.style.borderColor = '#22c55e';
  } else {
    btn.textContent = '🔔 監視';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

// ===== 応募一覧タブ =====
let currentSubmissions = [];

async function loadSubmissions() {
  const res = await fetch(`${API}/api/submissions/${currentLpId}?limit=200`);
  if (!res.ok) {
    document.getElementById('submissionsCount').textContent = '取得失敗';
    return;
  }
  const data = await res.json();
  currentSubmissions = data.submissions || [];
  document.getElementById('submissionsCount').textContent = `合計 ${data.total}件`;

  const container = document.getElementById('submissionsList');
  if (currentSubmissions.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:32px;text-align:center;">まだ応募はありません。<br>LP編集で「CTAアクション」を「モーダルでフォーム表示」or「最終ステップでフォーム自動表示」に変更してください。</p>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="border-bottom:1px solid var(--border);color:var(--text-muted);">
          <th style="padding:10px 12px;text-align:left;">日時</th>
          <th style="padding:10px 12px;text-align:left;">名前</th>
          <th style="padding:10px 12px;text-align:left;">電話</th>
          <th style="padding:10px 12px;text-align:left;">エリア</th>
          <th style="padding:10px 12px;text-align:left;">LINE/メール</th>
          <th style="padding:10px 12px;text-align:left;">メッセージ</th>
          <th style="padding:10px 12px;text-align:left;">流入元</th>
          <th style="padding:10px 12px;text-align:right;width:60px;"></th>
        </tr>
      </thead>
      <tbody>
        ${currentSubmissions.map(s => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:10px 12px;color:var(--text-muted);white-space:nowrap;">${new Date(s.submitted_at).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
            <td style="padding:10px 12px;font-weight:700;">${escapeHtml(s.name || '-')}</td>
            <td style="padding:10px 12px;"><a href="tel:${escapeHtml(s.phone || '')}" style="color:var(--primary-light);">${escapeHtml(s.phone || '-')}</a></td>
            <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary);">${escapeHtml(s.area || '-')}</td>
            <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary);">${[s.line_id, s.email].filter(Boolean).map(escapeHtml).join('<br>') || '-'}</td>
            <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(s.message || '')}">${escapeHtml(s.message || '-')}</td>
            <td style="padding:10px 12px;font-size:11px;color:var(--text-muted);">${escapeHtml([s.utm_source, s.utm_campaign].filter(Boolean).join('/') || '-')}</td>
            <td style="padding:10px 12px;text-align:right;"><button onclick="deleteSubmission(${s.id})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;" title="削除">🗑</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function deleteSubmission(id) {
  if (!confirm('この応募を削除しますか? (取り消せません)')) return;
  await fetch(`${API}/api/submissions/${id}`, { method: 'DELETE' });
  loadSubmissions();
}

function exportSubmissionsCSV() {
  if (!currentSubmissions || currentSubmissions.length === 0) {
    alert('エクスポートする応募がありません');
    return;
  }
  const headers = ['日時','名前','電話','LINE_ID','メール','エリア','メッセージ','utm_source','utm_medium','utm_campaign','utm_content','referrer'];
  const rows = currentSubmissions.map(s => [
    new Date(s.submitted_at).toLocaleString('ja-JP'),
    s.name || '', s.phone || '', s.line_id || '', s.email || '',
    s.area || '',
    (s.message || '').replace(/\n/g, ' '),
    s.utm_source || '', s.utm_medium || '', s.utm_campaign || '', s.utm_content || '',
    s.referrer || '',
  ]);
  const csv = '﻿' + [headers, ...rows].map(r =>
    r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
  ).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `submissions_${currentLpId}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 流入元分析の軸切り替え
document.addEventListener('DOMContentLoaded', () => {
  init();
  document.getElementById('attributionDimension')?.addEventListener('change', () => {
    if (currentTab === 'attribution') loadAttribution();
  });
});
