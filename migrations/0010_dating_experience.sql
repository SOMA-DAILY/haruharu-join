-- 완료 화면 선택 문항 (2026-10-10~): 최근 1년 소개팅 경험. 값은 쉼표로 이은 코드 (dating_app,friend_intro,offline,setlog_haruharu,none). 안 고르면 빈 값
-- 원격 적용: npx wrangler d1 execute haruharu-apply-db --remote --command "ALTER TABLE submissions ADD COLUMN dating_experience TEXT DEFAULT ''"
-- 이 열이 없어도 /api/experience 는 KV 정본에만 남기고 성공 처리함
ALTER TABLE submissions ADD COLUMN dating_experience TEXT DEFAULT '';
