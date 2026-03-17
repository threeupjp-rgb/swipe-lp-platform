const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'db', 'swipelp.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

// スキーマ実行
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

function uuid() {
  return crypto.randomUUID();
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

// デモLP登録 (横スワイプ)
const lpId = 'demo-lp-1';
const config = {
  direction: 'horizontal',
  steps: [
    {
      title: 'こんな悩みありませんか？',
      description: '毎月の支出が増えて、収入が足りないと感じていませんか',
      bgGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      textColor: '#ffffff'
    },
    {
      title: '解決策があります',
      description: '空いた時間を活用して、新しい収入源を作れる仕組みがあります',
      bgGradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      textColor: '#ffffff'
    },
    {
      title: '3つの特徴',
      description: '未経験OK・高収入・自由なシフト。あなたのペースで働けます',
      bgGradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      textColor: '#ffffff'
    },
    {
      title: '利用者の声',
      description: '「始めて3ヶ月で生活に余裕ができました」30代 女性',
      bgGradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      textColor: '#1a1a2e'
    },
    {
      title: '今すぐ始めよう',
      description: '無料で相談できます。まずは話を聞いてみませんか？',
      bgGradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      textColor: '#1a1a2e'
    }
  ]
};

// デモLP登録 (縦スワイプ)
const lpId2 = 'demo-lp-2';
const config2 = {
  direction: 'vertical',
  steps: [
    {
      title: 'スクロールで体験する',
      description: 'SNSのように上にスワイプして読み進めてください',
      bgGradient: 'linear-gradient(180deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
      textColor: '#ffffff'
    },
    {
      title: '没入感のある体験',
      description: '縦スワイプで自然なストーリーテリングを実現。TikTokやリールのような操作感',
      bgGradient: 'linear-gradient(180deg, #1a2a6c 0%, #b21f1f 50%, #fdbb2d 100%)',
      textColor: '#ffffff'
    },
    {
      title: '高いエンゲージメント',
      description: '縦スワイプLPはスクロール完読率が横型の1.5倍というデータがあります',
      bgGradient: 'linear-gradient(180deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
      textColor: '#ffffff'
    },
    {
      title: 'コンバージョンに直結',
      description: '最後まで読んだユーザーのCVRは通常LPの3倍以上',
      bgGradient: 'linear-gradient(180deg, #11998e 0%, #38ef7d 100%)',
      textColor: '#1a1a2e'
    },
    {
      title: '今すぐ試してみましょう',
      description: '下のボタンから無料でSwipeLPを作成できます',
      bgGradient: 'linear-gradient(180deg, #fc5c7d 0%, #6a82fb 100%)',
      textColor: '#ffffff'
    }
  ]
};

// 既存データクリア
db.exec("DELETE FROM events WHERE lp_id = 'demo-lp-1'");
db.exec("DELETE FROM sessions WHERE lp_id = 'demo-lp-1'");
db.exec("DELETE FROM lps WHERE id = 'demo-lp-1'");
db.exec("DELETE FROM events WHERE lp_id = 'demo-lp-2'");
db.exec("DELETE FROM sessions WHERE lp_id = 'demo-lp-2'");
db.exec("DELETE FROM lps WHERE id = 'demo-lp-2'");

const insertLp = db.prepare(`
  INSERT INTO lps (id, name, slug, config, cta_text, cta_url)
  VALUES (?, ?, ?, ?, ?, ?)
`);

insertLp.run(lpId, 'デモLP - 横スワイプ', 'demo-lp-1', JSON.stringify(config), '今すぐ応募する', 'https://example.com/apply');
insertLp.run(lpId2, 'デモLP - 縦スワイプ', 'demo-lp-2', JSON.stringify(config2), '無料で始める', 'https://example.com/start');

console.log('Demo LP created: demo-lp-1 (horizontal)');
console.log('Demo LP created: demo-lp-2 (vertical)');

// セッション & イベント生成 (両LP共通)
const lpIds = [lpId, lpId2];
const SESSION_COUNT = 200; // LP1つあたり
const devices = [
  { w: 375, h: 667, ua: 'iPhone SE' },
  { w: 390, h: 844, ua: 'iPhone 14' },
  { w: 430, h: 932, ua: 'iPhone 15 Pro Max' },
  { w: 360, h: 800, ua: 'Galaxy S21' },
  { w: 768, h: 1024, ua: 'iPad' },
  { w: 1920, h: 1080, ua: 'Desktop Chrome' }
];

const stepReachProb = [1.0, 0.72, 0.52, 0.33, 0.18];
const ctaClickProb = 0.07;

const insertSession = db.prepare(`
  INSERT INTO sessions (id, lp_id, user_agent, viewport_width, viewport_height, referrer, started_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertEvent = db.prepare(`
  INSERT INTO events (session_id, lp_id, event_type, step_index, data, timestamp)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const referrers = ['https://google.com', 'https://instagram.com', 'https://twitter.com', 'https://facebook.com', 'direct', ''];

for (const currentLpId of lpIds) {
  for (let i = 0; i < SESSION_COUNT; i++) {
    const sessionId = uuid();
    const device = devices[rand(0, devices.length - 1)];
    const referrer = referrers[rand(0, referrers.length - 1)];

    const baseTime = Date.now() - rand(0, 30 * 24 * 60 * 60 * 1000);
    let eventTime = baseTime;

    insertSession.run(
      sessionId, currentLpId, device.ua, device.w, device.h, referrer,
      new Date(baseTime).toISOString()
    );

    let maxStep = 0;
    for (let step = 0; step < 5; step++) {
      if (Math.random() > stepReachProb[step]) break;
      maxStep = step;

      insertEvent.run(
        sessionId, currentLpId, 'step_view', step,
        JSON.stringify({ from_step: step > 0 ? step - 1 : null, direction: 'forward' }),
        new Date(eventTime).toISOString()
      );
      eventTime += rand(500, 2000);

      const clickCount = rand(0, 3);
      for (let c = 0; c < clickCount; c++) {
        const isCtaArea = Math.random() < 0.4;
        const clickX = isCtaArea ? randFloat(0.3, 0.7) : randFloat(0.05, 0.95);
        const clickY = isCtaArea ? randFloat(0.85, 0.95) : randFloat(0.1, 0.9);

        insertEvent.run(
          sessionId, currentLpId, 'click', step,
          JSON.stringify({ x: Math.round(clickX * 1000) / 1000, y: Math.round(clickY * 1000) / 1000, element: 'content' }),
          new Date(eventTime).toISOString()
        );
        eventTime += rand(200, 1500);
      }

      const dwellMs = rand(2000, 15000);
      insertEvent.run(
        sessionId, currentLpId, 'dwell', step,
        JSON.stringify({ duration_ms: dwellMs }),
        new Date(eventTime).toISOString()
      );
      eventTime += dwellMs;
    }

    if (Math.random() < ctaClickProb) {
      insertEvent.run(
        sessionId, currentLpId, 'cta_click', maxStep,
        JSON.stringify({ step_index: maxStep, x: 0.5, y: 0.92 }),
        new Date(eventTime).toISOString()
      );
    }
  }
}

const sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
const eventCount = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
console.log(`Seeded: ${sessionCount} sessions, ${eventCount} events`);
console.log('Done!');
db.close();
