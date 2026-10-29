import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, COHORT_DEADLINES } from '../shared/forms.mjs';
import { feeFor, friendFee } from '../shared/friend-discount.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const PAGE = '/rejoin/seoul/returning-men/';
const at = Date.parse(COHORT_DEADLINES['8']) - 1;
const REVIEW = '로컬 검증: 서로 일상을 나누며 대화할 수 있어서 좋았습니다.';
async function submit(fields, time = at, path = PAGE) {
  const old = Date.now, writes = [], runs = [];
  Date.now = () => time;
  const DB = { prepare: sql => ({ bind: (...args) => ({ sql, args,
    all: async () => ({ results: [] }), run: async () => { runs.push({ sql, args }); return {}; } }) }),
    batch: async statements => { runs.push(...statements); return []; } };
  try {
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST',
      body: JSON.stringify({ path, fields: { phone: '01000000001', name: '로컬 남성 검사', sv_review: REVIEW, ...fields },
        hidden: { g: 'm', src: 'msg-seoul-returning-m', plan: 'regular', cohort: '7', fee: 5900 },
        ua: 'Android local QA', sid: '00000000-0000-4000-8000-000000000028' }) }),
      params: { path: ['submit'] }, env: { DB, APPLY_KV: { put: async (k, v) => writes.push([k, v]) } }, waitUntil() {} });
    const saved = writes.find(([k]) => k.startsWith('s:'));
    const stored = runs.find(r => /INSERT INTO submissions/.test(r.sql));
    return { res, rec: saved && JSON.parse(saved[1]), storedPath: stored?.args[2] };
  } finally { Date.now = old; }
}

test('남성용 8/9기 재참여는 8,000원 고정이며 기존 여성용 금액은 보존', () => {
  const page = formOf(PAGE);
  assert.equal(page.reviewCohort, '7');
  assert.equal(page.wishOptional, true);
  assert.equal(page.joinRequired, undefined);
  assert.equal(page.fee, 8000);
  assert.equal(page.wasFee, 10000);
  assert.deepEqual(Object.keys(page.joins), ['8기', '9기', '후기만']);
  for (const path of Object.values(page.joins)) {
    const f = formOf(path);
    assert.equal(f.fee, 8000);
    assert.equal(feeFor(f, '남성').pay, 'https://haruharu-pay.pages.dev/mr/');
    assert.equal(friendFee(f, { phone: '01000000001', buddy: '01000000002', buddy_room: '같은 방' }), 0);
  }
  assert.equal(formOf('/rejoin/seoul/returning/').fee, 5900);
  assert.equal(formOf('/rejoin/7/seoul/').fee, 5900);
});

test('고른 기수·남성·8,000원 경로로 저장하고 7기 후기와 선택 바라는 점을 보존', async () => {
  for (const cohort of ['8', '9']) for (const sv_wish of ['', '대화 시간이 더 있었으면 해요', '좋아요']) {
    const { res, rec, storedPath } = await submit({ sv_join: cohort + '기', sv_wish, sv_cohorts: '["6"]' });
    assert.equal(res.status, 200);
    assert.equal(storedPath, `/${cohort}/seoul/rejoin/returning-men/`);
    assert.equal(rec.hidden.cohort, cohort);
    assert.equal(rec.hidden.plan, 'discount');
    assert.equal(rec.fields.gender, '남성');
    assert.equal(rec.from_page, PAGE);
    assert.equal(rec.hidden.src, 'msg-seoul-returning-m');
    assert.equal(formOf(storedPath).fee, 8000);
    assert.deepEqual(rec.survey, { sv_review: REVIEW, ...(sv_wish ? { sv_wish } : {}), sv_cohorts: ['7'] });
    assert.equal(rec.friend_fee, undefined);
  }
});

test('후기 없이 제출하거나 허용하지 않은 기수·잘못된 친구 번호는 접수하지 않음', async () => {
  for (const sv_join of [undefined, '', '7기', '10기']) {
    const { res, rec } = await submit({ sv_join });
    assert.equal(res.status, 400); assert.equal(rec, undefined);
  }
  for (const sv_join of ['후기만', '8기', '9기']) for (const sv_review of [undefined, '', '짧음']) {
    const bad = await submit({ sv_join, sv_review });
    assert.equal(bad.res.status, 400); assert.equal(bad.rec, undefined);
    assert.ok((await bad.res.json()).miss.includes('sv_review'));
  }
  assert.equal((await submit({ sv_join: '8기', buddy_room: '같은 방', buddy: '01000000001' })).res.status, 400);
  const friend = await submit({ sv_join: '8기', buddy_room: '같은 방', buddy: '01000000002' });
  assert.equal(friend.res.status, 200); assert.equal(friend.rec.friend_fee, undefined);
  assert.equal(formOf(friend.storedPath).fee, 8000);
});

test('후기만은 익명 접수이며 연락처·친구 정보 없이 마감 후에도 제출 가능', async () => {
  for (const sv_join of ['후기만']) {
    const { res, rec, storedPath } = await submit({ sv_join, buddy: '01000000002', buddy_room: '같은 방' }, Date.parse(COHORT_DEADLINES['9']) + 1);
    assert.equal(res.status, 200);
    assert.equal(storedPath, PAGE);
    assert.equal(rec.hidden.plan, 'review');
    assert.equal(rec.hidden.cohort, 'review');
    assert.equal(rec.phone_digits, '');
    for (const key of ['phone', 'name', 'buddy', 'buddy_room']) assert.equal(rec.fields[key], undefined);
    assert.deepEqual(rec.survey, { sv_review: REVIEW, sv_cohorts: ['7'] });
  }
});

test('직접 재신청 경로에서도 후기는 필수이며 기존 7기 폼의 필수 규칙은 보존', async () => {
  for (const cohort of ['8', '9']) {
    const path = `/${cohort}/seoul/rejoin/returning-men/`;
    const good = await submit({}, at, path);
    assert.equal(good.res.status, 200); assert.equal(good.storedPath, path);
    assert.deepEqual(good.rec.survey.sv_cohorts, ['7']);
    assert.equal((await submit({ sv_review: '' }, at, path)).res.status, 400);
  }
  const legacy = await submit({ sv_join: '후기만', sv_wish: '' }, at, '/rejoin/7/seoul/');
  assert.equal(legacy.res.status, 400);
  assert.ok((await legacy.res.json()).miss.includes('sv_wish'));
});

test('각 기수의 마감 경계를 지키고 8기 마감 후에도 9기는 신청 가능', async () => {
  for (const c of ['8', '9']) {
    const deadline = Date.parse(COHORT_DEADLINES[c]);
    assert.equal((await submit({ sv_join: c + '기' }, deadline - 1)).res.status, 200);
    const closed = await submit({ sv_join: c + '기' }, deadline);
    assert.equal(closed.res.status, 409); assert.equal(closed.rec, undefined);
  }
  assert.equal((await submit({ sv_join: '9기' }, Date.parse(COHORT_DEADLINES['8']))).res.status, 200);
});

test('남성용 화면은 7기 후기 필수·바라는 점 선택이며 일정과 송금은 8,000원으로 일치', () => {
  const html = readFileSync(new URL('../public' + PAGE + 'index.html', import.meta.url), 'utf8');
  assert.match(html, /<h1 class="sv-h1">7기, 어땠어요\?<\/h1>/);
  assert.match(html, /7기 참가자 전용/);
  assert.match(html, /10,000원/);
  assert.match(html, /href="https:\/\/haruharu-pay\.pages\.dev\/mr\/"/);
  assert.match(html, /10\/30\(금\) ~ 11\/1\(일\)/);
  assert.match(html, /11\/6\(금\) ~ 11\/8\(일\)/);
  assert.doesNotMatch(html, /5,900원/);
  assert.match(html, /<textarea name="sv_review"[^>]*data-min="10"/);
  assert.match(html, /name="sv_review_ok"[^>]*required/);
  assert.doesNotMatch(html.match(/<input\b[^>]*name="sv_wish_ok"[^>]*>/)?.[0] || '', /required/);
  assert.match(html, /name="sv_join" value="후기만" checked/);
  assert.doesNotMatch(html.match(/<textarea\b[^>]*name="sv_wish"[^>]*>/)?.[0] || '', /placeholder=/);
});
