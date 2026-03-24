const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function handleBase64Upload(req, res) {
  try {
    const { data, filename, mimeType } = req.body;
    if (!data) return res.status(400).json({ error: 'data フィールドが必要です' });

    const mime = mimeType || 'image/jpeg';
    const ext = ALLOWED_TYPES[mime];
    if (!ext) return res.status(400).json({ error: `非対応の形式: ${mime}` });

    // Base64デコード
    const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_SIZE) {
      return res.status(400).json({ error: 'ファイルサイズが10MBを超えています' });
    }

    const id = crypto.randomUUID().split('-')[0];
    const savedName = `${id}${ext}`;
    const savePath = path.join(UPLOAD_DIR, savedName);

    fs.writeFileSync(savePath, buffer);

    res.json({
      url: `/uploads/${savedName}`,
      filename: savedName,
      size: buffer.length
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

  req.on('end', () => {
    if (res.headersSent) return;
    const buffer = Buffer.concat(chunks);
    const id = crypto.randomUUID().split('-')[0];
    const savedName = `${id}${ext}`;
    const savePath = path.join(UPLOAD_DIR, savedName);

    fs.writeFileSync(savePath, buffer);

    res.json({
      url: `/uploads/${savedName}`,
      filename: savedName,
      size: buffer.length
    });
  });

  req.on('error', () => {
    res.status(500).json({ error: 'アップロードエラー' });
  });
}

module.exports = router;
