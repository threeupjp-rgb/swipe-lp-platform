class HeatmapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.palette = this._createPalette();
  }

  render(clickData, bgGradient, width = 390, height = 844) {
    // Canvas解像度設定
    const scale = 2; // Retina対応
    this.canvas.width = width * scale;
    this.canvas.height = height * scale;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.scale(scale, scale);

    // 背景描画
    this._drawBackground(bgGradient, width, height);

    if (!clickData || clickData.length === 0) {
      this._drawEmptyMessage(width, height);
      return;
    }

    // ヒートマップ描画（別Canvasで作成して合成）
    const heatCanvas = document.createElement('canvas');
    heatCanvas.width = width * scale;
    heatCanvas.height = height * scale;
    const heatCtx = heatCanvas.getContext('2d');
    heatCtx.scale(scale, scale);

    // 最大値算出
    const maxCount = Math.max(...clickData.map(d => d.count));

    // グレースケールヒートポイント描画
    heatCtx.globalCompositeOperation = 'lighter';
    for (const point of clickData) {
      const px = point.x * width;
      const py = point.y * height;
      const intensity = point.count / maxCount;
      const radius = 25 + intensity * 30;

      const grad = heatCtx.createRadialGradient(px, py, 0, px, py, radius);
      const alpha = Math.min(intensity * 0.8, 1);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');

      heatCtx.fillStyle = grad;
      heatCtx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
    }

    // カラーマッピング
    this._colorize(heatCtx, width * scale, height * scale);

    // メインCanvasに合成
    this.ctx.globalAlpha = 0.65;
    this.ctx.drawImage(heatCanvas, 0, 0, width, height);
    this.ctx.globalAlpha = 1;

    // クリック数ラベル
    this._drawLabels(clickData, width, height, maxCount);
  }

  _drawBackground(bgGradient, w, h) {
    if (bgGradient) {
      // CSSグラデーションをCanvas用に変換（簡易実装）
      const colors = bgGradient.match(/#[0-9a-fA-F]{6}/g) || ['#667eea', '#764ba2'];
      const grad = this.ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(1, colors[1] || colors[0]);
      this.ctx.fillStyle = grad;
    } else {
      this.ctx.fillStyle = '#1a1a2e';
    }
    this.ctx.fillRect(0, 0, w, h);
  }

  _drawEmptyMessage(w, h) {
    this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
    this.ctx.font = '14px -apple-system, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('クリックデータがありません', w / 2, h / 2);
  }

  _colorize(ctx, w, h) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const paletteIndex = Math.min(alpha, 255);
      const color = this.palette[paletteIndex];
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      // alphaはそのまま
    }

    ctx.putImageData(imageData, 0, 0);
  }

  _createPalette() {
    const palette = new Array(256);
    const gradientStops = [
      { pos: 0, r: 0, g: 0, b: 255 },       // 青
      { pos: 0.25, r: 0, g: 255, b: 255 },   // シアン
      { pos: 0.5, r: 0, g: 255, b: 0 },      // 緑
      { pos: 0.75, r: 255, g: 255, b: 0 },   // 黄
      { pos: 1.0, r: 255, g: 0, b: 0 }       // 赤
    ];

    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let lower = gradientStops[0], upper = gradientStops[gradientStops.length - 1];
      for (let j = 0; j < gradientStops.length - 1; j++) {
        if (t >= gradientStops[j].pos && t <= gradientStops[j + 1].pos) {
          lower = gradientStops[j];
          upper = gradientStops[j + 1];
          break;
        }
      }
      const range = upper.pos - lower.pos;
      const factor = range === 0 ? 0 : (t - lower.pos) / range;
      palette[i] = [
        Math.round(lower.r + (upper.r - lower.r) * factor),
        Math.round(lower.g + (upper.g - lower.g) * factor),
        Math.round(lower.b + (upper.b - lower.b) * factor)
      ];
    }
    return palette;
  }

  _drawLabels(clickData, w, h, maxCount) {
    // 上位5個のクリックポイントにラベル表示
    const top5 = [...clickData].sort((a, b) => b.count - a.count).slice(0, 5);
    this.ctx.font = 'bold 11px -apple-system, sans-serif';
    this.ctx.textAlign = 'center';

    for (const point of top5) {
      const px = point.x * w;
      const py = point.y * h;

      // バブル背景
      this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const text = `${point.count}`;
      const tw = this.ctx.measureText(text).width + 12;
      this.ctx.beginPath();
      this.ctx.roundRect(px - tw / 2, py - 20, tw, 18, 4);
      this.ctx.fill();

      // テキスト
      this.ctx.fillStyle = '#fff';
      this.ctx.fillText(text, px, py - 7);
    }
  }
}
