-- 2026-09-28 3기 본모집: 같이 하고 싶은 사람(선택 문항), 요금제(regular/early)
ALTER TABLE submissions ADD COLUMN buddy TEXT DEFAULT '';
ALTER TABLE submissions ADD COLUMN plan TEXT DEFAULT '';
