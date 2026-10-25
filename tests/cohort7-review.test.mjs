import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, formStatus, COHORT_DEADLINES, FORMS, COHORT_INFO } from '../shared/forms.mjs';
import { reviewRows } from '../shared/review-cohorts.mjs';
import { friendFee } from '../shared/friend-discount.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const PAGE = '/rejoin/7/seoul/';
const JOIN8 = '/8/seoul/rejoin/from-7/', JOIN9 = '/9/seoul/rejoin/from-7/';
const BEFORE = Date.parse(COHORT_DEADLINES['8']) - 1;
const FEEDBACK = { sv_review: '가상 검증: 일상을 나누며 대화할 수 있어서 좋았어요.', sv_wish: '가상 검증: 다음에는 대화할 주제가 더 다양했으면 좋겠어요.' };

async function submit(path, extra = {}, at = BEFORE) {
  const old = Date.now, writes = [], runs = [];
  Date.now = () => at;
  const DB = { prepare: sql => ({ bind: (...args) => ({ sql, args,
    all: async () => ({ results: [] }), run: async () => { runs.push({ sql, args }); return {}; }
  }) }), batch: async statements => { runs.push(...statements); return []; } };
  try {
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST',
      body: JSON.stringify({ path, fields: { ...FEEDBACK, ...extra }, hidden: { g: 'f', src: 'rejoin-7-msg' },
        sid: '00000000-0000-4000-8000-000000000007' }) }), params: { path: ['submit'] },
      env: { APPLY_KV: { put: async (key, value) => writes.push([key, value]) }, DB }, waitUntil() {} });
    const record = writes.find(([key]) => key.startsWith('s:'));
    return { res, record: record && JSON.parse(record[1]), runs };
  } finally { Date.now = old; }
}

test('7기 전용 폼의 8/9기 재신청은 추가 친구 할인 없이 5,900원 고정', () => {
  const page = formOf(PAGE);
  assert.ok(page);
  assert.deepEqual(page.joins, { '8기': JOIN8, '9기': JOIN9, '후기만': PAGE });
  for (const path of [PAGE, JOIN8, JOIN9]) {
    const form = formOf(path);
    assert.equal(form.reviewCohort, '7');
    assert.equal(form.buddyOnly, true);
    assert.equal(form.fee, 5900);
    assert.match(form.pay, /\/b\/$/);
    assert.equal(form.friendFee, undefined);
    assert.equal(form.maleFee, undefined);
    assert.equal(friendFee(form, { phone: '01000000001', buddy: '01000000002', buddy_room: '같은 방' }), 0);
  }
  assert.equal(formOf('/8/seoul/').maleFee, 10000);
  assert.equal(formOf('/9/seoul/').maleFee, 10000);
});

test('후기만은 익명이며 전송된 연락처·친구 정보와 위조 기수를 저장하지 않음', async () => {
  for (const sv_cohorts of [undefined, '["6"]', '["9"]', 'invalid']) {
    const { res, record, runs } = await submit(PAGE, { sv_join: '후기만', sv_cohorts,
      phone: '01000000001', name: '가상 검사', buddy: '01000000002', buddy_room: '같은 방' });
    assert.equal(res.status, 200);
    assert.deepEqual(record.survey.sv_cohorts, ['7']);
    assert.equal(record.hidden.cohort, 'review');
    assert.equal(record.hidden.plan, 'review');
    assert.equal(record.from_page, PAGE);
    assert.equal(record.phone_digits, '');
    for (const key of ['phone', 'name', 'buddy', 'buddy_room']) assert.equal(record.fields[key], undefined);
    const update = runs.find(({ sql }) => /UPDATE submissions SET survey/.test(sql));
    assert.deepEqual(JSON.parse(update.args[1]).sv_cohorts, ['7']);
  }
});

test('8/9기 선택은 해당 재신청 경로에 저장되며 후기 출처는 7기 유지', async () => {
  for (const [sv_join, path, cohort] of [['8기', JOIN8, '8'], ['9기', JOIN9, '9']]) {
    const { res, record, runs } = await submit(PAGE, { sv_join, phone: '01000000001', name: '가상 검사', sv_cohorts: '["6"]' });
    assert.equal(res.status, 200);
    assert.equal(record.hidden.cohort, cohort);
    assert.equal(record.hidden.g, 'f');
    assert.equal(record.hidden.src, 'rejoin-7-msg');
    assert.equal(record.from_page, PAGE);
    assert.deepEqual(record.survey.sv_cohorts, ['7']);
    const insert = runs.find(({ sql }) => /INSERT OR REPLACE INTO submissions/.test(sql));
    assert.equal(insert.args[2], path);
    const review = reviewRows([{ application_id: record.id, path, survey: JSON.stringify(record.survey), submitted_ts: BEFORE }],
      { FORMS, DEADLINES: COHORT_DEADLINES, INFO: COHORT_INFO })[0];
    assert.equal(review.participant, '7기 참가자');
    const direct = await submit(path, { phone: '01000000001', name: '가상 검사', sv_cohorts: '["8"]' });
    assert.equal(direct.res.status, 200);
    assert.deepEqual(direct.record.survey.sv_cohorts, ['7']);
  }
});

test('각 기수 마감은 개별 적용, 두 기수가 닫힌 뒤에도 익명 후기 접수', async () => {
  for (const [cohort, path] of [['8', JOIN8], ['9', JOIN9]]) {
    const deadline = Date.parse(COHORT_DEADLINES[cohort]);
    assert.equal(formStatus(path, deadline - 1, {}, 'f').open, true);
    assert.equal(formStatus(path, deadline, {}, 'f').open, false);
    const extra = { sv_join: cohort + '기', phone: '01000000001', name: '가상 검사' };
    assert.equal((await submit(PAGE, extra, deadline - 1)).res.status, 200);
    const closed = await submit(PAGE, extra, deadline);
    assert.equal(closed.res.status, 409);
    assert.equal(closed.record, undefined);
    assert.equal(closed.runs.length, 0);
  }
  assert.equal((await submit(PAGE, { sv_join: '9기', phone: '01000000001', name: '가상 검사' }, Date.parse(COHORT_DEADLINES['8']))).res.status, 200);
  const end = Date.parse(COHORT_DEADLINES['9']) + 1;
  assert.equal(formStatus(PAGE, end).open, true);
  assert.equal((await submit(PAGE, { sv_join: '후기만' }, end)).res.status, 200);
});

test('친구 방 희망은 저장하되 추가 할인 없음; 잘못된 친구 번호는 저장 전에 거절', async () => {
  for (const sv_join of ['8기', '9기']) for (const buddy_room of ['같은 방', '다른 방', '상관없음']) {
    const result = await submit(PAGE, { sv_join, phone: '01000000001', name: '가상 검사', buddy_room, buddy: '010-0000-0002' });
    assert.equal(result.res.status, 200);
    assert.equal(result.record.fields.buddy, '01000000002');
    assert.equal(result.record.fields.buddy_room, buddy_room);
    assert.equal(result.record.friend_fee, undefined);
  }
  for (const buddy of ['', '123', '01000000001']) {
    const bad = await submit(PAGE, { sv_join: '8기', phone: '01000000001', name: '가상 검사', buddy_room: '같은 방', buddy });
    assert.equal(bad.res.status, 400);
    assert.equal(bad.record, undefined);
  }
});

test('새 화면은 기존 6기 폼 디자인, 7기 후기와 8/9기 일정만 표시', () => {
  const html = readFileSync(new URL('../public' + PAGE + 'index.html', import.meta.url), 'utf8');
  assert.match(html, /7기, 어땠어요\?/);
  assert.match(html, /7기 참가자 전용/);
  for (const key of ['sv_review', 'sv_wish']) assert.match(html, new RegExp('name="' + key + '"'));
  for (const cohort of ['8', '9']) assert.match(html, new RegExp('name="sv_join" value="' + cohort + '기"'));
  assert.match(html, /name="sv_join" value="후기만" checked/);
  assert.match(html, /10\/30\(금\) ~ 11\/1\(일\)/);
  assert.match(html, /11\/6\(금\) ~ 11\/8\(일\)/);
  assert.match(html, /5,900원/);
  assert.match(html, /id="acctCopy"/);
  assert.match(html, /href="https:\/\/haruharu-pay.pages.dev\/b\/"/);
  const visible = html.replace(/<(script|style)[\s\S]*?<\/(script|style)>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const forbidden of ['6기 참가자 전용', 'name="sv_cohorts"', 'value="7기"', '3,900', 'pages.dev/k/']) assert.equal(visible.includes(forbidden), false, forbidden);
});
