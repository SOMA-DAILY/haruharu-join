import { COHORT_DEADLINES, COHORT_INFO } from './forms.mjs';
import { cohortChoices } from './review-cohorts.mjs';

export const surveyCohortChoices = (now = Date.now()) => cohortChoices(COHORT_DEADLINES, now, COHORT_INFO);

// 재참여 설문 (10/17~): 지난 참가자가 지난 기수 후기와 다음 기수에 바라는 점을 적으면 재참여 할인(등록부 survey 폼의 fee).
// 문항은 이 파일 한 곳: build-v2.sh 가 화면을 찍고, 서버가 값을 걸러 저장하고, 관리 화면이 모아 봄.
//   10/17 운영자: 고르는 설문 대신 주관식 두 문항으로 (처음엔 고르는 문항 12개로 만들었다가 바꿈). 할인 조건이라 둘 다 필수, min 자 이상
// 문항 글자를 바꾸면 지난 응답과 모아 보기가 갈리니, 뜻이 바뀔 때는 새 key 로
export const SURVEY_SECTIONS = [{ title: '', keys: ['sv_review', 'sv_wish'] }];

export const SURVEY = {
  sv_review: { type: 'text', title: '지난 기수 후기', hint: '좋았던 점, 아쉬웠던 점 모두 편하게 적어 주세요', min: 10, max: 1000,
    placeholder: '예) 미션 덕분에 말 걸기가 편했어요. 둘째 날부터 방이 조용해진 건 아쉬웠어요.' },
  sv_wish: { type: 'text', title: '다음 기수에 바라는 점', hint: '방 구성, 진행 방식, 미션 등 무엇이든 좋아요', min: 10, max: 1000,
    placeholder: '예) 비슷한 나이대끼리 모였으면 좋겠어요. 중간에 1:1로 이야기할 시간도 있으면 좋겠어요.' },
};
export const SURVEY_KEYS = SURVEY_SECTIONS.flatMap((s) => s.keys);

// 재참여 모집용 선택 입력. 기존 후기 폼의 필수 규칙은 바꾸지 않는다.
export function cleanOptionalWish(fields) {
  const value = typeof fields?.sv_wish === 'string' ? fields.sv_wish.replace(/\r/g, '').trim().slice(0, 1000) : '';
  return value ? { survey: { sv_wish: value }, miss: [] } : null;
}

// 제출된 값 → 저장할 설문 + 빠진(또는 너무 짧은) 문항
export function cleanSurvey(fields, now = Date.now(), { wishOptional = false } = {}) {
  const raw = fields && typeof fields === 'object' ? fields : {};
  const out = {}, miss = [];
  for (const k of SURVEY_KEYS) {
    const q = SURVEY[k];
    const v = (typeof raw[k] === 'string' ? raw[k] : '').replace(/\r/g, '').trim().slice(0, q.max || 1000);
    const optional = q.optional || (wishOptional && k === 'sv_wish');
    if (v.length >= (optional ? 1 : q.min || 1)) out[k] = v;
    else if (!optional) miss.push(k);
  }
  // Optional on the API so an already-open form can still submit after deployment.
  // The new form asks explicitly; metadata shares the existing survey JSON column.
  if (raw.sv_cohorts != null) {
    let values = raw.sv_cohorts;
    if (typeof values === 'string') { try { values = JSON.parse(values); } catch { values = null; } }
    const allowed = new Set(surveyCohortChoices(now).map((choice) => choice.value));
    if (!Array.isArray(values) || !values.length || values.length > allowed.size ||
      values.some((value) => typeof value !== 'string' || !allowed.has(value)) ||
      (values.includes('unknown') && values.length !== 1)) miss.push('sv_cohorts');
    else out.sv_cohorts = [...new Set(values)];
  }
  return { survey: out, miss };
}
