class SwipeEngine {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      direction: 'horizontal', // 'horizontal' | 'vertical'
      threshold: 0.3,
      velocityThreshold: 0.5,
      rubberBand: true,
      rubberBandFactor: 0.3,
      ...options
    };

    this.isVertical = this.options.direction === 'vertical';

    this.state = {
      currentIndex: 0,
      totalSteps: 0,
      isDragging: false,
      startX: 0,
      startY: 0,
      delta: 0,          // 主軸方向の移動量
      startTime: 0,
      isAnimating: false,
      containerSize: 0,   // 主軸方向のコンテナサイズ
      directionLocked: null
    };

    this.track = null;
    this.listeners = {};
    this._onResize = this._onResize.bind(this);
  }

  init(steps) {
    this.state.totalSteps = steps.length;
    this.state.containerSize = this.isVertical
      ? this.container.offsetHeight
      : this.container.offsetWidth;

    // 方向クラスを付与
    this.container.classList.add(this.isVertical ? 'vertical' : 'horizontal');

    // DOM構築
    this.track = document.createElement('div');
    this.track.className = 'swipe-track';
    if (this.isVertical) this.track.classList.add('swipe-track-v');

    steps.forEach((step, i) => {
      const el = document.createElement('div');
      el.className = 'swipe-step';
      el.dataset.index = i;

      // 背景
      const bg = document.createElement('div');
      bg.className = 'step-bg';
      if (step.image) {
        const img = document.createElement('img');
        img.className = 'step-image';
        img.src = step.image;
        img.alt = step.title || `Step ${i + 1}`;
        img.loading = i <= 1 ? 'eager' : 'lazy';
        img.draggable = false;
        bg.appendChild(img);
      } else if (step.bgGradient) {
        bg.style.background = step.bgGradient;
      }
      el.appendChild(bg);

      // ステップ番号
      const badge = document.createElement('div');
      badge.className = 'step-badge';
      badge.style.color = step.textColor || '#fff';
      badge.textContent = `${i + 1} / ${steps.length}`;
      el.appendChild(badge);

      // コンテンツ
      const content = document.createElement('div');
      content.className = 'step-content';
      content.style.color = step.textColor || '#fff';

      if (step.title) {
        const h2 = document.createElement('h2');
        h2.textContent = step.title;
        content.appendChild(h2);
      }
      if (step.description) {
        const p = document.createElement('p');
        p.textContent = step.description;
        content.appendChild(p);
      }
      el.appendChild(content);

      this.track.appendChild(el);
    });

    this.container.appendChild(this.track);

    this._bindEvents();
    this._updateTransform(false);

    window.addEventListener('resize', this._onResize);
  }

  _bindEvents() {
    // タッチイベント
    this.container.addEventListener('touchstart', (e) => this._onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    this.container.addEventListener('touchmove', (e) => this._onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    this.container.addEventListener('touchend', () => this._onEnd());
    this.container.addEventListener('touchcancel', () => this._onEnd());

    // マウスイベント
    this.container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this._onStart(e.clientX, e.clientY);
    });
    this.container.addEventListener('mousemove', (e) => {
      if (!this.state.isDragging) return;
      e.preventDefault();
      this._onMove(e.clientX, e.clientY, e);
    });
    this.container.addEventListener('mouseup', () => this._onEnd());
    this.container.addEventListener('mouseleave', () => {
      if (this.state.isDragging) this._onEnd();
    });

    // キーボード
    document.addEventListener('keydown', (e) => {
      if (this.isVertical) {
        if (e.key === 'ArrowUp') this.prev();
        else if (e.key === 'ArrowDown') this.next();
      } else {
        if (e.key === 'ArrowLeft') this.prev();
        else if (e.key === 'ArrowRight') this.next();
      }
    });

    // アニメーション完了
    this.track.addEventListener('transitionend', () => {
      this.state.isAnimating = false;
      this.track.classList.remove('animating');
    });

    // 安全弁: transitionendが発火しない場合のフォールバック
    // (同じ位置へのアニメーション等)
    this._animTimeout = null;
  }

  _onStart(x, y) {
    if (this.state.isAnimating) return;
    this.state.isDragging = true;
    this.state.startX = x;
    this.state.startY = y;
    this.state.delta = 0;
    this.state.startTime = Date.now();
    this.state.directionLocked = null;
    this.track.classList.remove('animating');
    this._emit('swipeStart', { index: this.state.currentIndex });
  }

  _onMove(x, y, e) {
    if (!this.state.isDragging) return;

    const dx = x - this.state.startX;
    const dy = y - this.state.startY;

    // 方向ロック判定
    if (!this.state.directionLocked) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        const isMovingHorizontal = Math.abs(dx) > Math.abs(dy);
        if (this.isVertical) {
          // 縦モード: 縦方向の移動を主軸として扱う
          this.state.directionLocked = isMovingHorizontal ? 'cross' : 'main';
        } else {
          // 横モード: 横方向の移動を主軸として扱う
          this.state.directionLocked = isMovingHorizontal ? 'main' : 'cross';
        }
      } else {
        return;
      }
    }

    // クロス軸方向ならスワイプ無視
    if (this.state.directionLocked === 'cross') return;

    if (e.cancelable) e.preventDefault();

    // 主軸方向のdelta
    let delta = this.isVertical ? dy : dx;

    // ゴムバンド効果
    if (this.options.rubberBand) {
      const isAtStart = this.state.currentIndex === 0 && delta > 0;
      const isAtEnd = this.state.currentIndex === this.state.totalSteps - 1 && delta < 0;
      if (isAtStart || isAtEnd) {
        delta *= this.options.rubberBandFactor;
      }
    }

    this.state.delta = delta;
    this._updateTransform(false);
  }

  _onEnd() {
    if (!this.state.isDragging) return;
    this.state.isDragging = false;

    // 方向未確定 or クロス軸 → deltaは0のままなのでアニメ不要
    if (this.state.directionLocked !== 'main') {
      this.state.delta = 0;
      this._updateTransform(false);
      return;
    }

    const elapsed = Date.now() - this.state.startTime;
    const velocity = Math.abs(this.state.delta) / elapsed;
    const size = this.state.containerSize;
    const absDelta = Math.abs(this.state.delta);

    let targetIndex = this.state.currentIndex;

    if (velocity > this.options.velocityThreshold || absDelta > size * this.options.threshold) {
      if (this.state.delta < 0 && this.state.currentIndex < this.state.totalSteps - 1) {
        targetIndex++;
      } else if (this.state.delta > 0 && this.state.currentIndex > 0) {
        targetIndex--;
      }
    }

    if (targetIndex === this.state.currentIndex && absDelta > 20) {
      this._emit('edgeBounce', {
        index: this.state.currentIndex,
        direction: this.state.delta > 0 ? 'start' : 'end'
      });
    }

    this.state.delta = 0;
    this.goTo(targetIndex, true);
    this._emit('swipeEnd', { index: targetIndex });
  }

  _updateTransform(animate) {
    const offset = -(this.state.currentIndex * this.state.containerSize) + this.state.delta;
    if (animate) {
      this.track.classList.add('animating');
      this.state.isAnimating = true;

      // 安全弁: 400ms後にisAnimatingを強制解除 (transitionendが来ない場合)
      clearTimeout(this._animTimeout);
      this._animTimeout = setTimeout(() => {
        this.state.isAnimating = false;
        this.track.classList.remove('animating');
      }, 400);
    }
    if (this.isVertical) {
      this.track.style.transform = `translate3d(0, ${offset}px, 0)`;
    } else {
      this.track.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
  }

  _onResize() {
    this.state.containerSize = this.isVertical
      ? this.container.offsetHeight
      : this.container.offsetWidth;
    this.state.delta = 0;
    this._updateTransform(false);
  }

  goTo(index, animate = true) {
    const prevIndex = this.state.currentIndex;
    this.state.currentIndex = Math.max(0, Math.min(index, this.state.totalSteps - 1));
    this._updateTransform(animate);

    if (prevIndex !== this.state.currentIndex) {
      this._emit('stepChange', {
        from: prevIndex,
        to: this.state.currentIndex,
        direction: this.state.currentIndex > prevIndex ? 'forward' : 'backward'
      });
    }
  }

  next() {
    if (this.state.currentIndex < this.state.totalSteps - 1) {
      this.goTo(this.state.currentIndex + 1);
    }
  }

  prev() {
    if (this.state.currentIndex > 0) {
      this.goTo(this.state.currentIndex - 1);
    }
  }

  getCurrentIndex() {
    return this.state.currentIndex;
  }

  getDirection() {
    return this.options.direction;
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  _emit(event, data) {
    (this.listeners[event] || []).forEach(cb => cb(data));
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
  }
}
