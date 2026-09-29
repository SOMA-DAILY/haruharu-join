-- 폼 = 경로 단위 (/, /seoul/, /gwangju/ ...). 처음 방문이 들어오면 자동 등록, 이름은 관리 페이지에서 바꿈
CREATE TABLE IF NOT EXISTS forms (
  path TEXT PRIMARY KEY,
  name TEXT,
  kind TEXT DEFAULT 'form',          -- form | landing
  city TEXT,
  archived INTEGER DEFAULT 0,
  created_at INTEGER
);
-- 링크(src) 등록부. 트래픽에 나온 미등록 src 도 관리 페이지에 따로 보임
CREATE TABLE IF NOT EXISTS links (
  src TEXT PRIMARY KEY,
  path TEXT,
  label TEXT,
  channel TEXT,                      -- meta | insta | everytime | direct | etc
  note TEXT,
  archived INTEGER DEFAULT 0,
  created_at INTEGER
);
-- 방문 1회 = 1행 (탭 세션 기준 sid + path)
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT NOT NULL,
  path TEXT NOT NULL,
  city TEXT, src TEXT, channel TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, fbclid INTEGER DEFAULT 0,
  ref TEXT, ua TEXT, device TEXT, in_app TEXT, is_bot INTEGER DEFAULT 0, is_return INTEGER DEFAULT 0,
  first_ts INTEGER, last_ts INTEGER, active_ms INTEGER DEFAULT 0, max_scroll INTEGER DEFAULT 0,
  started INTEGER DEFAULT 0, started_ts INTEGER,
  max_page INTEGER DEFAULT 1, last_field TEXT, fields TEXT, filled INTEGER DEFAULT 0,
  next_click TEXT,                   -- 랜딩(지역 선택)에서 누른 곳
  submitted INTEGER DEFAULT 0, submitted_ts INTEGER, application_id TEXT,
  PRIMARY KEY (sid, path)
);
CREATE INDEX IF NOT EXISTS idx_sessions_first ON sessions(first_ts);
CREATE INDEX IF NOT EXISTS idx_sessions_path ON sessions(path, first_ts);
CREATE INDEX IF NOT EXISTS idx_sessions_src ON sessions(src, first_ts);
-- 제출 사본 (정본은 KV). 관리 페이지 조회/조인용
CREATE TABLE IF NOT EXISTS submissions (
  application_id TEXT PRIMARY KEY,
  kv_key TEXT, path TEXT, city TEXT, cohort TEXT, src TEXT, channel TEXT,
  submitted_ts INTEGER, submitted_at TEXT,
  name TEXT, phone TEXT, phone_digits TEXT, gender TEXT, birth_year TEXT, school TEXT,
  source TEXT, device TEXT, intent TEXT, intent_other TEXT, consent TEXT,
  status TEXT DEFAULT '', memo TEXT DEFAULT '', status_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sub_ts ON submissions(submitted_ts);
