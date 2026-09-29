-- 관리 페이지 ping(15초마다 MAX(last_ts)) 이 테이블 전체를 읽지 않게
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last_ts);
