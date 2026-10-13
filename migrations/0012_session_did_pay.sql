-- 관리 화면 사람 단위 퍼널 (2026-10-13~): did = 기기마다 한 번 만든 id (localStorage hh_did, 같은 기기 여러 방문을 한 사람으로), pay = 송금 버튼이나 계좌 복사를 누름
-- 원격 적용: npx wrangler d1 execute haruharu-apply-db --remote --command "ALTER TABLE sessions ADD COLUMN did TEXT; ALTER TABLE sessions ADD COLUMN pay INTEGER DEFAULT 0;"
-- 이 열이 없어도 /partial 은 기존대로 기록하고, 지표는 전화번호/성별+출생년도+학교로만 묶음
ALTER TABLE sessions ADD COLUMN did TEXT;
ALTER TABLE sessions ADD COLUMN pay INTEGER DEFAULT 0;
