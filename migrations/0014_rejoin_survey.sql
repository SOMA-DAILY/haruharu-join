-- 재참여 설문 (2026-10-17~, 등록부 survey 폼): 고른 답을 JSON 으로 (key 는 shared/rejoin-survey.mjs). 정본은 KV 제출 기록의 survey.
-- 원격 적용: npx wrangler d1 execute haruharu-apply-db --remote --command "ALTER TABLE submissions ADD COLUMN survey TEXT DEFAULT ''"
-- 이 열이 없어도 신청은 그대로 접수됨 (서버가 batch 밖에서 따로 채움). 그동안 관리 화면에는 설문이 안 보이고 KV 에만 있음.
-- 번호 0013 은 성비 맞추기 브랜치(feat/ratio-system-phase1)가 쓰고 있어서 건너뜀
ALTER TABLE submissions ADD COLUMN survey TEXT DEFAULT '';
