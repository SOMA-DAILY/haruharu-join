-- 2026-09-30 전남대 축제 이벤트 신청폼(/jnu-festival/): 학과, 같은 과 피하기(같은 과 피하기 / 상관없음), 학생 인증 캡처 KV 키(img:{신청ID})
-- 제출 사본은 기존 INSERT 뒤에 축제 신청만 UPDATE 로 채우므로, 이 열이 없어도 기존 폼 제출 사본은 그대로 들어감
ALTER TABLE submissions ADD COLUMN major TEXT DEFAULT '';
ALTER TABLE submissions ADD COLUMN avoid_same_major TEXT DEFAULT '';
ALTER TABLE submissions ADD COLUMN student_card_key TEXT DEFAULT '';
