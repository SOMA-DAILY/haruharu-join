import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cohortChoices, reviewRows } from '../shared/review-cohorts.mjs';
import { cleanSurvey } from '../shared/rejoin-survey.mjs';
import { FORMS, COHORT_DEADLINES, COHORT_INFO } from '../shared/forms.mjs';

const registry = { FORMS, DEADLINES: COHORT_DEADLINES, INFO: COHORT_INFO };
const at = Date.parse('2026-10-19T12:00:00+09:00');
const feedback = { sv_review: '미션 덕분에 자연스럽게 이야기를 시작했어요.', sv_wish: '다음에는 또래끼리 만날 수 있으면 좋겠어요.' };
const review = (values = {}) => ({ application_id: 'review-001', path: '/7/seoul/rejoin/', cohort: '7', submitted_ts: at, survey: JSON.stringify(feedback), ...values });
const prior = (values = {}) => ({ application_id: 'prior-001', path: '/5/seoul/', cohort: '5', phone_digits: '01000000001', status: '확정', room: '가상 QA 방', submitted_ts: at - 10 * 86400e3, ...values });

test('참여 기수 선택지는 모집 중인 다음 기수를 제외하고 1, 2기와 축제를 포함한다', () => {
  const values = cohortChoices(COHORT_DEADLINES, at, COHORT_INFO).map((choice) => choice.value);
  assert(values.includes('1') && values.includes('2') && values.includes('6') && values.includes('jnu-festival'));
  assert(!values.includes('7'));
  assert(!cohortChoices(COHORT_DEADLINES, Date.parse('2026-10-22T12:00:00+09:00'), COHORT_INFO).some((choice) => choice.value === '7'));
  assert(cohortChoices(COHORT_DEADLINES, Date.parse('2026-10-23T12:00:00+09:00'), COHORT_INFO).some((choice) => choice.value === '7'));
});

test('설문은 참여 기수만 검증해 JSON에 보존하고 다음 신청 기수와 분리한다', () => {
  const value = cleanSurvey({ ...feedback, sv_cohorts: '["4","5","4"]' }, at);
  assert.deepEqual(value.miss, []);
  assert.deepEqual(value.survey.sv_cohorts, ['4', '5']);
  for (const sv_cohorts of ['["7"]', '["<script>"]', 'unknown', '[]', '{}', '["5","unknown"]']) {
    assert(cleanSurvey({ ...feedback, sv_cohorts }, at).miss.includes('sv_cohorts'), sv_cohorts);
  }
  assert.deepEqual(cleanSurvey({ ...feedback, sv_cohorts: '["unknown"]' }, at).survey.sv_cohorts, ['unknown']);
  // Already-open forms without the new optional metadata remain submit-compatible.
  assert.deepEqual(cleanSurvey(feedback, at).survey, feedback);
});

test('기존 익명 응답의 다음 신청 기수나 이름으로 참여 기수를 추측하지 않는다', () => {
  for (const cohort of ['7', 'review']) {
    const rows = reviewRows([review({ cohort, name: '같은 이름' }), prior({ name: '같은 이름' })], registry);
    assert.deepEqual(rows[0].cohorts, ['unknown']); assert.equal(rows[0].gender, '성별 미확인');
  }
});

test('같은 번호의 이전 확정 및 방 배정 기록만 연결하며 취소, 미배정, 미래 신청은 제외한다', () => {
  const r = review({ phone_digits: '01000000001' });
  const valid = prior();
  const applications = [r, valid, prior({ application_id: 'cancelled', cohort: '4', status: '취소' }), prior({ application_id: 'pending', cohort: '3', room: '' }),
    prior({ application_id: 'future', path: '/7/seoul/', cohort: '7' }), prior({ application_id: 'after', submitted_ts: at + 1000 }),
    prior({ application_id: 'alert', path: '/4/seoul-work/pre/', cohort: '4', plan: 'prealert' })];
  const rows = reviewRows(applications, registry);
  assert.deepEqual(rows[0].cohorts, ['5']); assert.equal(rows[0].source, '이전 확정 기록');
});

test('본인 응답 우선, 복수 기수 중복 제거, 명시한 미확인은 그대로, 응답 중복 제거', () => {
  const r = review({ phone_digits: '01000000001', gender: '여성', survey: JSON.stringify({ ...feedback, sv_cohorts: ['3', '4', '3'] }) });
  const rows = reviewRows([r, r, prior()], registry);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].cohorts, ['4', '3']); assert.equal(rows[0].source, '본인 응답');
  assert.equal(rows[0].participant, '4기, 3기 참가자'); assert.equal(rows[0].gender, '여성');
  assert.deepEqual(reviewRows([review({ ...r, survey: JSON.stringify({ ...feedback, sv_cohorts: ['unknown'] }) }), prior()], registry)[0].cohorts, ['unknown']);
  assert.equal(reviewRows([review({ survey: '{invalid' })], registry).length, 0);
});

test('같은 번호의 과거 송금확인은 방 미배정이어도 참여 기수 추정에 사용한다', () => {
  const rows = reviewRows([review({ phone_digits: '010-0000-0001' }),
    prior({ status: '송금확인', room: '' }),
    prior({ application_id: 'paid-4', cohort: '4', status: '송금확인', room: '' }),
    prior({ application_id: 'paid-4-duplicate', cohort: '4', status: '송금확인', room: '' })], registry);
  assert.deepEqual(rows[0].cohorts, ['5', '4']);
  assert.equal(rows[0].participant, '5기, 4기 참가자');
  assert.equal(rows[0].source, '이전 송금확인 기록');
  assert.equal(rows[0].estimated, true);
});

test('송금 추정에서도 미송금, 취소, 사전알림, 후기 이후 신청과 다음 기수는 제외한다', () => {
  const rows = reviewRows([review({ phone_digits: '01000000001' }),
    ...['', '송금확인 안됨', '취소', '결제 요청함'].map((status, i) => prior({ application_id: 'no-' + i, status, room: '' })),
    prior({ application_id: 'after', status: '송금확인', submitted_ts: at + 1 }),
    prior({ application_id: 'future-cohort', status: '송금확인', cohort: '7', path: '/7/seoul/' }),
    prior({ application_id: 'prealert', status: '송금확인', path: '/4/seoul-work/pre/', cohort: '4' }),
    prior({ application_id: 'review', status: '송금확인', path: '/6/seoul/rejoin/', cohort: '6' })], registry);
  assert.deepEqual(rows[0].cohorts, ['unknown']);
  assert.equal(rows[0].estimated, false);
});

test('직접 선택과 이전 확정 기록은 추정으로 표시하지 않는다', () => {
  const self = review({ phone_digits: '01000000001', survey: { ...feedback, sv_cohorts: ['3'] } });
  const paid = prior({ status: '송금확인', room: '' });
  assert.equal(reviewRows([self, paid], registry)[0].estimated, false);
  assert.equal(reviewRows([self, paid], registry)[0].participant, '3기 참가자');
  const exact = reviewRows([review({ phone_digits: '01000000001' }), paid, prior({ application_id: 'confirmed' })], registry)[0];
  assert.equal(exact.estimated, false);
  assert.equal(exact.source, '이전 확정 기록');
  assert.equal(exact.participant, '5기 참가자');
});
