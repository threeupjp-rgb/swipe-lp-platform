-- ランディングページ定義
CREATE TABLE IF NOT EXISTS lps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    config JSON NOT NULL,
    cta_text TEXT DEFAULT 'お問い合わせ',
    cta_url TEXT DEFAULT '#',
    notify_enabled INTEGER DEFAULT 0,
    notify_cvr_threshold REAL DEFAULT 1.0,
    notify_min_sessions INTEGER DEFAULT 50,
    notify_last_sent_at DATETIME,
    cta_microcopy TEXT,
    cta_color TEXT DEFAULT 'line-green',
    cta_color_custom TEXT,
    cta_show_final_large INTEGER DEFAULT 1,
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
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (lp_id) REFERENCES lps(id)
);

-- フォーム送信
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lp_id TEXT NOT NULL,
    name TEXT,
    phone TEXT,
    line_id TEXT,
    email TEXT,
    area TEXT,
    message TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    referrer TEXT,
    user_agent TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lp_id) REFERENCES lps(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_lp_id ON submissions(lp_id);
CREATE INDEX IF NOT EXISTS idx_submissions_lp_submitted ON submissions(lp_id, submitted_at);

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

-- Meta Conversions API トークン (ピクセル単位で管理)
CREATE TABLE IF NOT EXISTS meta_capi_tokens (
    pixel_id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    test_event_code TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- パフォーマンス用インデックス
CREATE INDEX IF NOT EXISTS idx_events_lp_id ON events(lp_id);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_lp_step ON events(lp_id, step_index);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_lp_id ON sessions(lp_id);
-- 集計クエリの主用途に対する複合インデックス (lp_id + event_type + timestamp で範囲スキャン高速化)
CREATE INDEX IF NOT EXISTS idx_events_lp_type_ts ON events(lp_id, event_type, timestamp);
-- セッションの期間フィルタ (s.lp_id + s.started_at)
CREATE INDEX IF NOT EXISTS idx_sessions_lp_started ON sessions(lp_id, started_at);
