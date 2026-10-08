-- 친구 할인 (2026-10-08~): 신청자가 안내받은 친구 할인 금액(원). 할인 대상이 아니면 0.
-- 값은 서버가 제출 때 등록부 friendFee + 친구 문항으로 정함 (shared/friend-discount.mjs). 관리 화면이 송금할 금액과 환급 대상을 가릴 때 씀.
-- 원격 적용: npx wrangler d1 execute haruharu-apply-db --remote --command "ALTER TABLE submissions ADD COLUMN friend_fee INTEGER DEFAULT 0"
-- 이 열이 없어도 신청은 그대로 접수됨 (서버가 batch 밖에서 따로 채움). 그동안 관리 화면은 친구 문항으로 추정해서 보여 줌.
ALTER TABLE submissions ADD COLUMN friend_fee INTEGER DEFAULT 0;
