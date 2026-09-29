-- 신청자 목록 조인(submissions ↔ sessions)이 방문 기록 전체를 읽지 않게
CREATE INDEX IF NOT EXISTS idx_sessions_app ON sessions(application_id);
