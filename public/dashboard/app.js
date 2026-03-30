// ダッシュボード メインアプリケーション
const API = '';

let currentLpId = null;
let currentLpConfig = null;
let currentTab = 'overview';
let pollTimer = null;
let heatmapRenderer = null;

// 初期化
async function init() {
  await loadLpList();
  setupTabs();
  startPolling();
}

// LP一覧読み込み
async function loadLpList() {
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

  if (lps.length > 0) {
    currentLpId = lps[0].id;
    await loadLpDetail(currentLpId);
    loadTabData();
  }

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
  const res = await fetch(`${API}/api/analytics/${currentLpId}/overview`);
  const data = await res.json();

  document.getElementById('metricSessions').textContent = data.totalSessions.toLocaleString();
  document.getElementById('metricCta').textContent = data.totalCtaClicks.toLocaleString();
  document.getElementById('metricCvr').textContent = data.conversionRate + '%';
  document.getElementById('metricSteps').textContent = data.avgStepsViewed;
  document.getElementById('metricDuration').textContent = (data.avgSessionDuration / 1000).toFixed(1) + '秒';
  document.getElementById('metricBounce').textContent = data.bounceRate + '%';

  // CVRの色
  const cvrEl = document.getElementById('metricCvr');
  cvrEl.className = 'value ' + (data.conversionRate > 5 ? 'success' : data.conversionRate > 2 ? 'warning' : 'danger');

  // バウンス率の色
  const bounceEl = document.getElementById('metricBounce');
  bounceEl.className = 'value ' + (data.bounceRate < 30 ? 'success' : data.bounceRate < 50 ? 'warning' : 'danger');

  // ファネル簡易表示
  const funnelRes = await fetch(`${API}/api/analytics/${currentLpId}/funnel`);
  const funnelData = await funnelRes.json();
  renderFunnel(document.getElementById('overviewFunnel'), funnelData);

  // ステップ概要
  const stepsRes = await fetch(`${API}/api/analytics/${currentLpId}/steps`);
  const stepsData = await stepsRes.json();
  renderStepTable(document.getElementById('overviewStepTable'), stepsData);
}

// ステップ分析タブ
async function loadSteps() {
  const stepsRes = await fetch(`${API}/api/analytics/${currentLpId}/steps`);
  const stepsData = await stepsRes.json();
  renderStepTable(document.getElementById('stepsTable'), stepsData);

  const dwellRes = await fetch(`${API}/api/analytics/${currentLpId}/dwell-heatmap`);
  const dwellData = await dwellRes.json();
  renderDwellChart(document.getElementById('dwellChart'), dwellData);
}

// ヒートマップタブ
async function loadHeatmap(stepIndex = 0) {
  // ステップ選択リスト構築
  const stepsRes = await fetch(`${API}/api/analytics/${currentLpId}/steps`);
  const stepsData = await stepsRes.json();

  const listEl = document.getElementById('heatmapStepList');
  listEl.innerHTML = '';

  stepsData.steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.className = i === stepIndex ? 'active' : '';
    li.innerHTML = `
      <span>Step ${step.stepIndex + 1}</span>
      <span class="click-count">${step.clickCount}回</span>
    `;
    li.addEventListener('click', () => loadHeatmap(i));
    listEl.appendChild(li);
  });

  // ヒートマップ描画
  const heatRes = await fetch(`${API}/api/analytics/${currentLpId}/heatmap/${stepIndex}`);
  const heatData = await heatRes.json();

  const canvas = document.getElementById('heatmapCanvas');
  if (!heatmapRenderer) {
    heatmapRenderer = new HeatmapRenderer(canvas);
  }

  const bgGradient = currentLpConfig?.steps?.[stepIndex]?.bgGradient || null;
  heatmapRenderer.render(heatData.clicks, bgGradient);

  document.getElementById('heatmapTotalClicks').textContent = `総クリック数: ${heatData.totalClicks}`;
}

// ファネルタブ
async function loadFunnel() {
  const res = await fetch(`${API}/api/analytics/${currentLpId}/funnel`);
  const data = await res.json();
  renderFunnel(document.getElementById('funnelChart'), data);
}

// セッションタブ
async function loadSessions() {
  const res = await fetch(`${API}/api/analytics/${currentLpId}/sessions?limit=50`);
  const data = await res.json();

  document.getElementById('sessionTotal').textContent = `${data.total}件中 ${data.sessions.length}件表示`;
  renderSessionList(document.getElementById('sessionListContainer'), data, showSessionDetail);
}

// 流入元分析タブ
async function loadAttribution() {
  const dim = document.getElementById('attributionDimension').value;
  const res = await fetch(`${API}/api/analytics/${currentLpId}/attribution?dimension=${dim}`);
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
  const lineId = document.getElementById('createPixelLine').value.trim();
  if (metaId) pixels.meta = metaId;
  if (tiktokId) pixels.tiktok = tiktokId;
  if (googleId) pixels.google = googleId;
  if (googleLabel) pixels.googleConversionLabel = googleLabel;
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
    await loadLpList();

    // 作成したLPを選択
    const select = document.getElementById('lpSelect');
    select.value = data.id;
    currentLpId = data.id;
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
  document.getElementById('editCtaText').value = editLpData.cta_text || '';
  document.getElementById('editCtaUrl').value = editLpData.cta_url || '';

  // ピクセル
  const pixels = config.pixels || {};
  document.getElementById('editPixelMeta').value = pixels.meta || '';
  document.getElementById('editPixelTiktok').value = pixels.tiktok || '';
  document.getElementById('editPixelGoogle').value = pixels.google || '';
  document.getElementById('editPixelGoogleLabel').value = pixels.googleConversionLabel || '';
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
  const ctaText = document.getElementById('editCtaText').value.trim();
  const ctaUrl = document.getElementById('editCtaUrl').value.trim();

  if (!name) return alert('LP名を入力してください');

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
  const lineId = document.getElementById('editPixelLine').value.trim();
  if (metaId) pixels.meta = metaId;
  if (tiktokId) pixels.tiktok = tiktokId;
  if (googleId) pixels.google = googleId;
  if (googleLabel) pixels.googleConversionLabel = googleLabel;
  if (lineId) pixels.line = lineId;

  try {
    const res = await fetch(`/api/lps/${currentLpId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        config: { direction: editDirection, steps, pixels },
        cta_text: ctaText || 'お問い合わせ',
        cta_url: ctaUrl || '#'
      })
    });
    const data = await res.json();
    if (data.error) return alert(data.error);

    closeEditLP();
    await loadLpList();
    const select = document.getElementById('lpSelect');
    select.value = currentLpId;
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
