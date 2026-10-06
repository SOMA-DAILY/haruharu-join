-- 2026-10-06 4기 기수/트랙 분리: 트랙(seoul-student / gwangju-student / seoul-work / festival), 직장인 문항 [편한 진행 시기]
-- 제출 사본은 기존 INSERT 뒤에 UPDATE 로 채우므로, 원격에 이 열이 없어도 기존 폼 제출 사본은 그대로 들어감 (0007 과 같은 방식)
-- 원격 적용: npx wrangler d1 execute haruharu-apply-db --remote --command "ALTER TABLE submissions ADD COLUMN track TEXT DEFAULT ''; ALTER TABLE submissions ADD COLUMN schedule_pref TEXT DEFAULT '';"
ALTER TABLE submissions ADD COLUMN track TEXT DEFAULT '';
ALTER TABLE submissions ADD COLUMN schedule_pref TEXT DEFAULT '';
