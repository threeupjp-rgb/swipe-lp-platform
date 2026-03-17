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
          referrer: document.referrer || ''
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
    document.removeEventListener('visibilitychange', this._bound.visChange);
    window.removeEventListener('pagehide', this._bound.pageHide);
    this._recordDwell();
    this._sendBeacon();
  }
}
