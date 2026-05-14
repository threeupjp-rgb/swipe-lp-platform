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
async function loadLpList(preserveSelection = false) {
  const res = await fetch(`${API}/api/lps`);
  const lps = await res.json();

  const select = document.getElementById('lpSelect');
  select.innerHTML = '';
  lps.forEach(lp => {
    const opt = document.createElement('option');
    opt.value = lp.id;
    opt.textContent = lp.name;
    select.appendChild(opt);
  });

  if (preserveSelection && currentLpId) {
    // 編集後など: 既存の選択を維持
    select.value = currentLpId;
  } else if (lps.length > 0) {
    // 初回起動: 先頭のLPを選択
    currentLpId = lps[0].id;
    await loadLpDetail(currentLpId);
    loadTabData();
  }

  if (lpListChangeListenerAdded) return;
  lpListChangeListenerAdded = true;
  select.addEventListener('change', async () => {
    currentLpId = select.value;
    await loadLpDetail(currentLpId);
    loadTabData();
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
  }

  updateTimestamp();
}

// 概要タブ
async function loadOverview() {
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
  document.getElementById('createPixelMeta').value = '';
  document.getElementById('createPixelTiktok').value = '';
  document.getElementById('createPixelGoogle').value = '';
  document.getElementById('createPixelGoogleLabel').value = '';
  document.getElementById('createPixelGtm').value = '';
  document.getElementById('createPixelLine').value = '';
  renderStepsEditor();
  document.getElementById('createLpModal').classList.add('visible');
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

  try {
    const res = await fetch('/api/lps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        slug,
        config: { direction: createDirection, steps, pixels },
        cta_text: ctaText || 'お問い合わせ',
        cta_url: ctaUrl || '#'
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

  try {
    const res = await fetch(`/api/lps/${currentLpId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        slug,
        config: { direction: editDirection, steps, pixels },
        cta_text: ctaText || 'お問い合わせ',
        cta_url: ctaUrl || '#'
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

// 流入元分析の軸切り替え
document.addEventListener('DOMContentLoaded', () => {
  init();
  document.getElementById('attributionDimension')?.addEventListener('change', () => {
    if (currentTab === 'attribution') loadAttribution();
  });
});
