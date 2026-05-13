const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(__dirname, '..', 'uploads');

// 許可する画像形式
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_WIDTH = 1080; // スマホ全画面に最適な幅
const JPEG_QUALITY = 80;

// 画像最適化: リサイズ + 圧縮
async function optimizeImage(buffer, mimeType) {
  try {
    let pipeline = sharp(buffer).rotate(); // EXIF回転を反映
    const metadata = await pipeline.metadata();

    if (metadata.width && metadata.width > MAX_WIDTH) {
      pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true });
    }

    if (mimeType === 'image/png') {
      // PNG: 透過を保ったまま圧縮
      return { buffer: await pipeline.png({ compressionLevel: 9, quality: 85 }).toBuffer(), ext: '.png' };
    } else if (mimeType === 'image/gif') {
      // GIFはそのまま (アニメーションを保つ)
      return { buffer, ext: '.gif' };
    } else {
      // JPG/WebP/その他: mozjpeg圧縮されたJPEGに統一
      return { buffer: await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true }).toBuffer(), ext: '.jpg' };
    }
  } catch (e) {
    console.error('Image optimization failed:', e.message);
    // 最適化に失敗したら元のバッファを返す
    return { buffer, ext: ALLOWED_TYPES[mimeType] || '.jpg' };
  }
}

// 画像アップロード (multipart/form-data をパースする簡易実装)
router.post('/image', (req, res) => {
  const contentType = req.headers['content-type'] || '';

  // Base64アップロード (JSON)
  if (contentType.includes('application/json')) {
    return handleBase64Upload(req, res);
  }

  // バイナリアップロード
  if (contentType.includes('image/')) {
    return handleBinaryUpload(req, res, contentType.split(';')[0].trim());
  }

  res.status(400).json({ error: '対応していない形式です。image/* または JSON(base64) で送信してください' });
});

async function handleBase64Upload(req, res) {
  try {
    const { data, mimeType } = req.body;
    if (!data) return res.status(400).json({ error: 'data フィールドが必要です' });

    const mime = mimeType || 'image/jpeg';
    if (!ALLOWED_TYPES[mime]) return res.status(400).json({ error: `非対応の形式: ${mime}` });

    const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
    const rawBuffer = Buffer.from(base64Data, 'base64');

    if (rawBuffer.length > MAX_SIZE) {
      return res.status(400).json({ error: 'ファイルサイズが10MBを超えています' });
    }

    const { buffer, ext } = await optimizeImage(rawBuffer, mime);
    const id = crypto.randomUUID().split('-')[0];
    const savedName = `${id}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, savedName), buffer);

    res.json({
      url: `/uploads/${savedName}`,
      filename: savedName,
      size: buffer.length,
      originalSize: rawBuffer.length
    });
  } catch (e) {
    res.status(500).json({ error: 'アップロード失敗: ' + e.message });
  }
}

function handleBinaryUpload(req, res, mimeType) {
  const ext = ALLOWED_TYPES[mimeType];
  if (!ext) return res.status(400).json({ error: `非対応の形式: ${mimeType}` });

  const chunks = [];
  let totalSize = 0;

  req.on('data', chunk => {
    totalSize += chunk.length;
    if (totalSize > MAX_SIZE) {
      res.status(400).json({ error: 'ファイルサイズが10MBを超えています' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', async () => {
    if (res.headersSent) return;
    try {
      const rawBuffer = Buffer.concat(chunks);
      const { buffer, ext: optExt } = await optimizeImage(rawBuffer, mimeType);
      const id = crypto.randomUUID().split('-')[0];
      const savedName = `${id}${optExt}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, savedName), buffer);

      res.json({
        url: `/uploads/${savedName}`,
        filename: savedName,
        size: buffer.length,
        originalSize: rawBuffer.length
      });
    } catch (e) {
      res.status(500).json({ error: '画像処理失敗: ' + e.message });
    }
  });

  req.on('error', () => {
    res.status(500).json({ error: 'アップロードエラー' });
  });
}

// 既存画像の一括最適化 (POST /api/upload/optimize-existing)
router.post('/optimize-existing', async (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    const results = [];
    let totalBefore = 0;
    let totalAfter = 0;

    for (const filename of files) {
      const filepath = path.join(UPLOAD_DIR, filename);
      const stat = fs.statSync(filepath);
      if (!stat.isFile()) continue;

      const ext = path.extname(filename).toLowerCase();
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
      const mime = mimeMap[ext];
      if (!mime) continue;

      const before = stat.size;
      totalBefore += before;

      // 300KB未満はスキップ（既に軽い）
      if (before < 300 * 1024) {
        totalAfter += before;
        continue;
      }

      try {
        const rawBuffer = fs.readFileSync(filepath);
        const { buffer } = await optimizeImage(rawBuffer, mime);

        // 圧縮後の方が小さい場合のみ上書き（拡張子は維持してURL変えない）
        if (buffer.length < before) {
          fs.writeFileSync(filepath, buffer);
          totalAfter += buffer.length;
          results.push({ filename, before: Math.round(before/1024) + 'KB', after: Math.round(buffer.length/1024) + 'KB', saved: Math.round((1 - buffer.length/before)*100) + '%' });
        } else {
          totalAfter += before;
        }
      } catch (e) {
        results.push({ filename, error: e.message });
      }
    }

    res.json({
      processed: results.length,
      totalBefore: Math.round(totalBefore/1024) + 'KB',
      totalAfter: Math.round(totalAfter/1024) + 'KB',
      savedTotal: Math.round((1 - totalAfter/totalBefore)*100) + '%',
      details: results
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
