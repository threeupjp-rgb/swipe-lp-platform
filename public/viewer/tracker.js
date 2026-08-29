class SwipeLPTracker {
  constructor(lpId, options = {}) {
    this.lpId = lpId;
    this.sessionId = this._generateId();
    this.buffer = [];
    this.batchSize = options.batchSize || 10;
    this.flushInterval = options.flushInterval || 5000;
    this.apiBase = options.apiBase || '';
    this._flushTimer = null;
    this._dwellStart = null;
    this._currentStep = 0;
    this._bound = {};
  }

  _getUtmParams() {
    const p = new URLSearchParams(window.location.search);
    return {
      utm_source: p.get('utm_source') || '',
      utm_medium: p.get('utm_medium') || '',
      utm_campaign: p.get('utm_campaign') || '',
      utm_content: p.get('utm_content') || '',
      utm_term: p.get('utm_term') || ''
    };
  }

  async startSession() {
    try {
      await fetch(`${this.apiBase}/api/track/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          lpId: this.lpId,
          userAgent: navigator.userAgent,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          referrer: document.referrer || '',
          ...this._getUtmParams()
        })
      });
    } catch (e) { /* silent */ }

    // 定期フラッシュ
    this._flushTimer = setInterval(() => this.flush(), this.flushInterval);

    // ページ離脱時
    this._bound.visChange = () => {
      if (document.visibilityState === 'hidden') {
        this._recordDwell();
        this._sendBeacon();
      }
    };
    this._bound.pageHide = () => {
      this._recordDwell();
      this._sendBeacon();
    };

    document.addEventListener('visibilitychange', this._bound.visChange);
    window.addEventListener('pagehide', this._bound.pageHide);

    // 初回ステップビュー
    this.trackStepView(0, null);
    this._startDwell(0);
  }

  trackClick(stepIndex, event, stepElement) {
    if (!stepElement) return;
    const rect = stepElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    this._addEvent('click', stepIndex, {
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      element: event.target.tagName.toLowerCase()
    });
  }

  trackStepView(stepIndex, fromStep) {
    this._addEvent('step_view', stepIndex, {
      from_step: fromStep,
      direction: fromStep === null ? 'initial' : (stepIndex > fromStep ? 'forward' : 'backward')
    });
  }

  trackCtaClick(stepIndex) {
    this._addEvent('cta_click', stepIndex, {
      step_index: stepIndex,
      x: 0.5,
      y: 0.92
    });
  }

  onStepChange(fromStep, toStep) {
    this._recordDwell();
    this.trackStepView(toStep, fromStep);
    this._startDwell(toStep);
    this._currentStep = toStep;
  }

  // ===== スクロール深度計測 (scroll モード専用) =====
  // 注意: 画像の lazy-load でページ高が後から伸びるため、%はここでは確定させない。
  // px深度と計測時点のページ高を送り、サーバー側でセッション最終ページ高から%換算する。
  initScrollTracking() {
    this._scroll = {
      maxDepthPx: 0,
      lastSentDepthPx: 0,
      dwellBuckets: {},   // バケット先頭px -> 滞在ms (未送信分)
      bucketSize: 200,
      lastTick: Date.now(),
      timer: null
    };

    const measure = () => {
      const depth = (window.scrollY || document.documentElement.scrollTop || 0) + window.innerHeight;
      if (depth > this._scroll.maxDepthPx) this._scroll.maxDepthPx = depth;
    };

    let rafPending = false;
    this._bound.scroll = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; measure(); });
    };
    window.addEventListener('scroll', this._bound.scroll, { passive: true });
    measure();

    // 1秒ごとに画面内のpxバケットへ滞在時間を配分 (アテンションマップ用)
    this._scroll.timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this._scroll.lastTick;
      this._scroll.lastTick = now;
      // バックグラウンド放置分は滞在時間に含めない
      if (document.visibilityState !== 'visible' || elapsed <= 0 || elapsed > 5000) return;
      const top = window.scrollY || document.documentElement.scrollTop || 0;
      const bottom = top + window.innerHeight;
      const bs = this._scroll.bucketSize;
      for (let b = Math.floor(top / bs) * bs; b < bottom; b += bs) {
        const overlap = Math.min(bottom, b + bs) - Math.max(top, b);
        this._scroll.dwellBuckets[b] = (this._scroll.dwellBuckets[b] || 0) + Math.round(elapsed * overlap / (bottom - top));
      }
      measure();
    }, 1000);
  }

  // flush/beacon の直前に呼ばれ、未送信のスクロール深度・滞在分をバッファへ積む
  // (_addEvent 経由だと batchSize 到達で flush が再帰するため直接 push する)
  _emitScrollEvents() {
    if (!this._scroll) return;
    const pageHeight = document.documentElement.scrollHeight;

    if (this._scroll.maxDepthPx > this._scroll.lastSentDepthPx) {
      this._scroll.lastSentDepthPx = this._scroll.maxDepthPx;
      this.buffer.push({
        type: 'scroll_depth',
        stepIndex: null,
        data: {
          depth_px: Math.round(this._scroll.maxDepthPx),
          page_height: pageHeight,
          viewport_height: window.innerHeight
        },
        timestamp: Date.now()
      });
    }

    const buckets = this._scroll.dwellBuckets;
    if (Object.keys(buckets).length > 0) {
      this._scroll.dwellBuckets = {};
      this.buffer.push({
        type: 'scroll_dwell',
        stepIndex: null,
        data: { page_height: pageHeight, bucket_px: this._scroll.bucketSize, buckets },
        timestamp: Date.now()
      });
    }
  }

  _startDwell(stepIndex) {
    this._dwellStart = Date.now();
    this._currentStep = stepIndex;
  }

  _recordDwell() {
    if (this._dwellStart !== null) {
      const duration = Date.now() - this._dwellStart;
      if (duration > 500) {
        this._addEvent('dwell', this._currentStep, { duration_ms: duration });
      }
      this._dwellStart = null;
    }
  }

  _addEvent(type, stepIndex, data) {
    this.buffer.push({
      type,
      stepIndex,
      data,
      timestamp: Date.now()
    });
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }

  async flush() {
    this._emitScrollEvents();
    if (this.buffer.length === 0) return;
    const events = [...this.buffer];
    this.buffer = [];

    try {
      await fetch(`${this.apiBase}/api/track/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          lpId: this.lpId,
          events
        })
      });
    } catch (e) {
      // 送信失敗時はバッファに戻す
      this.buffer = events.concat(this.buffer);
    }
  }

  _sendBeacon() {
    this._emitScrollEvents();
    if (this.buffer.length === 0) return;
    const payload = JSON.stringify({
      sessionId: this.sessionId,
      lpId: this.lpId,
      events: this.buffer
    });
    this.buffer = [];
    navigator.sendBeacon(`${this.apiBase}/api/track/beacon`, payload);
  }

  _generateId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  destroy() {
    if (this._flushTimer) clearInterval(this._flushTimer);
    if (this._scroll && this._scroll.timer) clearInterval(this._scroll.timer);
    if (this._bound.scroll) window.removeEventListener('scroll', this._bound.scroll);
    document.removeEventListener('visibilitychange', this._bound.visChange);
    window.removeEventListener('pagehide', this._bound.pageHide);
    this._recordDwell();
    this._sendBeacon();
  }
}
