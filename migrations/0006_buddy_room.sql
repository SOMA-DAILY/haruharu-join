-- 2026-09-29 친구와 함께 신청: 혼자 / 같은 방 / 다른 방 / 상관없음. 친구 전화번호는 기존 buddy 열에 숫자로 저장
ALTER TABLE submissions ADD COLUMN buddy_room TEXT DEFAULT '';
