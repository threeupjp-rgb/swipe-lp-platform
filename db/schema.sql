-- ランディングページ定義
CREATE TABLE IF NOT EXISTS lps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    config JSON NOT NULL,
    cta_text TEXT DEFAULT 'お問い合わせ',
    cta_url TEXT DEFAULT '#',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- セッション（訪問者ごと）
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    lp_id TEXT NOT NULL,
    user_agent TEXT,
    viewport_width INTEGER,
    viewport_height INTEGER,
    referrer TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (lp_id) REFERENCES lps(id)
);

-- トラッキングイベント
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    lp_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    step_index INTEGER,
    data JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (lp_id) REFERENCES lps(id)
);

-- パフォーマンス用インデックス
CREATE INDEX IF NOT EXISTS idx_events_lp_id ON events(lp_id);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_lp_step ON events(lp_id, step_index);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_lp_id ON sessions(lp_id);
