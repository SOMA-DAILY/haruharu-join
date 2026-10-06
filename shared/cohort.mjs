// 기수 본모집 신청폼 마감 (/seoul/, /gwangju/, 사전알림 pre-4k9x, 할인 discount-4900, 지역 선택 /).
// 서버(/api/submit, /api/cohort)와 build.sh 가 같이 읽음. 축제 폼은 shared/jnu-festival.mjs 가 따로 봄
// 3기: 신청 마감 10/5(월) → 10/6 00:00 KST 부터 닫힘. 로컬 시험은 환경값 COHORT_DEADLINE(ISO 문자열 또는 ms)로 바꿈
export const COHORT_DEADLINE = '2026-10-06T00:00:00+09:00';

export function cohortDeadline(env) {
  const v = env && env.COHORT_DEADLINE;
  if (v) {
    const t = /^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v));
    if (Number.isFinite(t)) return t;
  }
  return Date.parse(COHORT_DEADLINE);
}
export function cohortStatus(now = Date.now(), env) {
  const deadline = cohortDeadline(env);
  return { open: now < deadline, deadline, serverNow: now };
}
