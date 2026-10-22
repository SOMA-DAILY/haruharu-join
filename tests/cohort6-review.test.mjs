import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, formStatus, COHORT_DEADLINES, FORMS, COHORT_INFO } from '../shared/forms.mjs';
import { reviewRows } from '../shared/review-cohorts.mjs';
import { friendFee } from '../shared/friend-discount.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const PAGE = '/rejoin/6/seoul/', JOIN = '/7/seoul/rejoin/from-6/', JOIN8 = '/8/seoul/rejoin/from-6/';
const BEFORE = Date.parse(COHORT_DEADLINES['7']) - 1;
const AFTER = BEFORE + 2;
const fields = () => ({ sv_join: '후기만', sv_review: '일상을 나누면서 편하게 이야기할 수 있어서 좋았어요.', sv_wish: '서로 대화할 수 있는 시간이 더 많았으면 좋겠어요.' });
async function submit(path, extra = {}, at = BEFORE) {
  const old = Date.now, writes = [], runs = [];
  Date.now = () => at;
  const DB = { prepare: (sql) => ({ bind: (...args) => ({ sql, args, all: async () => ({ results: [] }), run: async () => { runs.push({ sql, args }); return {}; } }) }), batch: async (statements) => { runs.push(...statements); return []; } };
  try {
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields: { ...fields(), ...extra }, sid: '00000000-0000-4000-8000-000000000006' }) }), params: { path: ['submit'] }, env: { APPLY_KV: { put: async (key, value) => writes.push([key, value]) }, DB }, waitUntil: () => {} });
    const rec = writes.find(([key]) => key.startsWith('s:'));
    return { res, record: rec && JSON.parse(rec[1]), runs };
  } finally { Date.now = old; }
}

test('6기 전용 폼은 7기/8기 재신청 모두 5,900원 고정, 후기 접수는 마감 없음', () => {
  const page = formOf(PAGE), join = formOf(JOIN), join8 = formOf(JOIN8);
  assert.ok(page && join && join8);
  assert.deepEqual(page.joins, { '7기': JOIN, '8기': JOIN8, '후기만': PAGE });
  for (const f of [page, join, join8]) {
    assert.equal(f.reviewCohort, '6'); assert.equal(f.buddyOnly, true);
    assert.equal(f.fee, 5900); assert.match(f.pay, /\/b\/$/);
    assert.equal(f.friendFee, undefined); assert.equal(f.friendPay, undefined);
    assert.equal(friendFee(f, { phone: '01000000001', buddy: '01000000002', buddy_room: '같은 방' }), 0);
  }
  assert.equal(formStatus(PAGE, AFTER).open, true);
  assert.equal(formStatus(JOIN, BEFORE).open, true);
  assert.equal(formStatus(JOIN, AFTER).open, false);
});

test('익명 후기와 재신청 모두 서버에서 6기로 고정하고 관리자에 6기 참가자로 표시', async () => {
  for (const extra of [{}, { sv_cohorts: '["5"]' }, { sv_cohorts: 'invalid' }, ...['7기', '8기'].map(sv_join => ({ sv_join, phone: '01000000001', name: '로컬테스트', buddy: '01000000002', buddy_room: '같은 방', sv_cohorts: '["7"]' }))]) {
    const { res, record, runs } = await submit(PAGE, extra);
    assert.equal(res.status, 200);
    assert.deepEqual(record.survey.sv_cohorts, ['6']);
    assert.equal(record.from_page, PAGE);
    assert.equal(record.hidden.cohort, extra.sv_join ? extra.sv_join.replace('기', '') : 'review');
    assert.equal(record.friend_fee, undefined);
    assert.equal(record.fields.buddy, extra.sv_join ? '01000000002' : undefined); assert.equal(record.fields.buddy_room, extra.sv_join ? '같은 방' : undefined);
    if (!extra.sv_join) assert.equal(record.phone_digits, '');
    const storedSurvey = runs.find(({ sql }) => /UPDATE submissions SET survey/.test(sql));
    assert.deepEqual(JSON.parse(storedSurvey.args[1]).sv_cohorts, ['6']);
    const row = { application_id: record.id, path: extra.sv_join === '8기' ? JOIN8 : extra.sv_join === '7기' ? JOIN : PAGE, survey: JSON.stringify(record.survey), submitted_ts: BEFORE };
    assert.equal(reviewRows([row], { FORMS, DEADLINES: COHORT_DEADLINES, INFO: COHORT_INFO })[0].participant, '6기 참가자');
  }
  for (const path of [JOIN, JOIN8]) {
    const direct = await submit(path, { phone: '01000000001', name: '로컬테스트', sv_cohorts: '["1"]' });
    assert.equal(direct.res.status, 200); assert.deepEqual(direct.record.survey.sv_cohorts, ['6']);
  }
});

test('7기 마감 뒤에도 8기를 신청할 수 있고, 8기 마감 뒤에는 후기만 접수', async () => {
  const extra = { sv_join: '8기', phone: '01000000001', name: '로컬테스트' };
  for (const at of [AFTER, Date.parse(COHORT_DEADLINES['8']) - 1]) {
    const eight = await submit(PAGE, extra, at);
    assert.equal(eight.res.status, 200);
    assert.equal(eight.record.hidden.cohort, '8');
    assert.deepEqual(eight.record.survey.sv_cohorts, ['6']);
    const ins = eight.runs.find(({ sql }) => /INSERT OR REPLACE INTO submissions/.test(sql));
    assert.equal(ins.args[2], JOIN8);
  }
  const end = Date.parse(COHORT_DEADLINES['8']);
  const closed = await submit(PAGE, extra, end);
  assert.equal(closed.res.status, 409); assert.equal(closed.record, undefined);
  assert.equal((await submit(PAGE, {}, end)).res.status, 200);
});

test('마감 뒤 익명 후기는 받되 재신청은 저장하지 않고 거절, 짧은 후기도 거절', async () => {
  const anonymous = await submit(PAGE, {}, AFTER);
  assert.equal(anonymous.res.status, 200);
  assert.deepEqual(anonymous.record.survey.sv_cohorts, ['6']);
  const closed = await submit(PAGE, { sv_join: '7기', phone: '01000000001', name: '로컬테스트' }, AFTER);
  assert.equal(closed.res.status, 409); assert.equal(closed.record, undefined);
  const short = await submit(PAGE, { sv_review: '짧음' });
  assert.equal(short.res.status, 400); assert.ok((await short.res.json()).miss.includes('sv_review'));
});

test('6기 화면: 후기 기수 선택 없이 후기 두 칸, 친구 동반/방 배정, 고정 참가비와 계좌 복사', () => {
  const html = readFileSync(new URL('../public' + PAGE + 'index.html', import.meta.url), 'utf8');
  assert.match(html, /6기, 어땠어요\?/);
  assert.match(html, /6기 참가자 전용/);
  assert.match(html, /name="sv_review"/); assert.match(html, /name="sv_wish"/);
  assert.match(html, /name="sv_join" value="7기"/); assert.match(html, /name="sv_join" value="8기"/); assert.match(html, /name="sv_join" value="후기만" checked/);
  assert.match(html, /name="buddy_room" value="같은 방"/); assert.match(html, /name="buddy"/);
  assert.match(html, /5,900원/); assert.match(html, /id="acctCopy"/);
  assert.match(html, /href="https:\/\/haruharu-pay.pages.dev\/b\/"/);
  for (const text of ['어느 기수에 참여하셨나요?', 'name="sv_cohorts"', '친구 할인', '친구랑 같이 신청', '3,900', 'pages.dev/k/']) assert.equal(html.replace(/<(script|style)[\s\S]*?<\/(script|style)>/g, '').replace(/<!--[\s\S]*?-->/g, '').includes(text), false, text);
});


test('친구 동반은 방 배정과 번호만 저장하고 참가비는 5,900원 고정', async () => {
  for (const sv_join of ['7기', '8기']) for (const buddy_room of ['같은 방', '다른 방', '상관없음']) {
    const result = await submit(PAGE, { sv_join, phone: '01000000001', name: '로컬친구테스트', buddy_room, buddy: '010-0000-0002' });
    assert.equal(result.res.status, 200);
    assert.equal(result.record.fields.buddy, '01000000002');
    assert.equal(result.record.fields.buddy_room, buddy_room);
    assert.equal(result.record.friend_fee, undefined);
    assert.deepEqual(result.record.survey.sv_cohorts, ['6']);
  }
  for (const buddy of ['', '123', '01000000001']) {
    const bad = await submit(PAGE, { sv_join: '8기', phone: '01000000001', name: '로컬테스트', buddy_room: '같은 방', buddy });
    assert.equal(bad.res.status, 400); assert.ok((await bad.res.json()).miss.includes('buddy')); assert.equal(bad.record, undefined);
  }
  const alone = await submit(PAGE, { sv_join: '8기', phone: '01000000001', name: '로컬테스트', buddy_room: '혼자', buddy: '01000000002' });
  assert.equal(alone.res.status, 200); assert.equal(alone.record.fields.buddy, undefined);
  const anonymous = await submit(PAGE, { buddy_room: '같은 방', buddy: '01000000002' });
  assert.equal(anonymous.res.status, 200); assert.equal(anonymous.record.fields.buddy, undefined); assert.equal(anonymous.record.fields.buddy_room, undefined);
});
