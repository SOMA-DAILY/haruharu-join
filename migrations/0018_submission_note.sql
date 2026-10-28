-- 기타 사항 (10/28 이야기판 신청서, 제출 바로 앞 선택 글 칸). 원격 적용: npx wrangler d1 execute haruharu-apply-db --remote --command "ALTER TABLE submissions ADD COLUMN note TEXT DEFAULT ''"
ALTER TABLE submissions ADD COLUMN note TEXT DEFAULT '';
