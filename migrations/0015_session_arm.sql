-- 50/50 팔 라벨 (10/20): functions/7/seoul/index.js 쿠키 a|b. 적용: npx wrangler d1 migrations apply haruharu-apply-db --remote
ALTER TABLE sessions ADD COLUMN arm TEXT;
