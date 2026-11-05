import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, COHORT_DEADLINES } from '../shared/forms.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const PAGE = '/rejoin/seoul/returning/';
const at = Date.parse(COHORT_DEADLINES['8']) - 1;
async function submit(fields, time = at, path = PAGE) {
  const old = Date.now, writes = [], runs = [];
  Date.now = () => time;
  const DB = { prepare: sql => ({ bind: (...args) => ({ sql, args,
    all: async () => ({ results: [] }), run: async () => { runs.push({ sql, args }); return {}; }
  }) }), batch: async statements => { runs.push(...statements); return []; } };
  try {
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST',
      body: JSON.stringify({ path, fields: { phone: '01000000001', name: '로컬 검사', ...fields },
        hidden: { g: 'f', src: 'msg-seoul-returning-f' }, sid: '00000000-0000-4000-8000-000000000016' }) }),
      params: { path: ['submit'] }, env: { DB, APPLY_KV: { put: async (k, v) => writes.push([k, v]) } }, waitUntil() {} });
    const saved = writes.find(([k]) => k.startsWith('s:'));
    return { res, rec: saved && JSON.parse(saved[1]), runs };
  } finally { Date.now = old; }
}

test('기존 참가자용은 8/9기 선택만 가능, 5,900원 고정, 기존 후기 폼 보존', () => {
  const f = formOf(PAGE);
  assert.ok(f?.wishOnly);
  assert.equal(f.joinRequired, true);
  assert.deepEqual(Object.keys(f.joins), ['8기', '9기']);
  for (const path of Object.values(f.joins)) {
    const g = formOf(path);
    assert.equal(g.fee, 5900); assert.equal(g.wishOnly, true);
    assert.equal(g.friendFee, undefined); assert.equal(g.reviewCohort, null);
  }
  assert.equal(formOf('/rejoin/7/seoul/').reviewCohort, '7');
  assert.equal(formOf('/8/seoul/').fee, 7900);
});

test('후기 없이 바라는 점 공란/공백/한 글자/1,000자로 신청 가능', async () => {
  for (const sv_join of ['8기', '9기']) for (const sv_wish of [undefined, '', '   ', '굿', '가'.repeat(1000)]) {
    const { res, rec } = await submit({ sv_join, sv_wish });
    assert.equal(res.status, 200);
    assert.equal(rec.hidden.cohort, sv_join[0]);
    assert.equal(rec.from_page, PAGE);
    assert.equal(rec.hidden.g, 'f');
    assert.equal(rec.hidden.src, 'msg-seoul-returning-f');
    if (!sv_wish?.trim()) assert.equal(rec.survey, undefined);
    else assert.deepEqual(rec.survey, { sv_wish: sv_wish.trim() });
  }
});

test('미선택·후기만·임의 기수는 접수 안 함; 전화번호와 송금자명은 필수', async () => {
  for (const sv_join of [undefined, '', '후기만', '7기', '10기']) {
    const { res, rec } = await submit({ sv_join });
    assert.equal(res.status, 400); assert.equal(rec, undefined);
  }
  for (const missing of ['phone', 'name']) {
    const { res } = await submit({ sv_join: '8기', [missing]: '' });
    assert.equal(res.status, 400);
  }
});

test('후기·과거 기수 위조를 버리고 바라는 점만 저장; 1,000자 제한', async () => {
  const { res, rec } = await submit({ sv_join: '8기', sv_wish: '\r\n' + '가'.repeat(1100), sv_review: '위조 후기', sv_cohorts: '["7"]' });
  assert.equal(res.status, 200);
  assert.deepEqual(rec.survey, { sv_wish: '가'.repeat(1000) });
});

test('8/9기 개별 마감 적용 및 친구 요청 검증, 추가 할인 없음', async () => {
  for (const c of ['8', '9']) {
    const end = Date.parse(COHORT_DEADLINES[c]);
    assert.equal((await submit({ sv_join: c + '기' }, end - 1)).res.status, 200);
    const closed = await submit({ sv_join: c + '기' }, end);
    assert.equal(closed.res.status, 409); assert.equal(closed.rec, undefined);
    const { res, rec } = await submit({ sv_join: c + '기', buddy_room: '같은 방', buddy: '01000000002' });
    assert.equal(res.status, 200); assert.equal(rec.friend_fee, undefined);
    assert.equal(rec.fields.buddy, '01000000002');
  }
  assert.equal((await submit({ sv_join: '9기' }, Date.parse(COHORT_DEADLINES['8']))).res.status, 200);
  assert.equal((await submit({ sv_join: '8기', buddy_room: '같은 방', buddy: '123' })).res.status, 400);
});

test('화면에는 후기 없음, 기수 선택 → 바라는 점(선택) → 연락처 순서', () => {
  const html = readFileSync(new URL('../public' + PAGE + 'index.html', import.meta.url), 'utf8');
  assert(!/<(?:input|textarea)[^>]*name="sv_review"/.test(html)); assert(!/<(?:input|textarea)[^>]*name="sv_cohorts"/.test(html));
  assert(html.includes('data-required-join="true"'));
  assert(html.indexOf('data-name="sv_join"') < html.indexOf('data-name="sv_wish"'));
  assert(html.indexOf('data-name="sv_wish"') < html.indexOf('data-name="phone"'));
  assert.match(html, /다음 기수에 바라는 점.*?선택/);
  assert(!/name="sv_wish_ok"[^>]*required/.test(html));
  assert.match(html, /5,900원/); assert.match(html, /10\/30\(금\) ~ 11\/1\(일\)/);
  assert.match(html, /11\/6\(금\) ~ 11\/8\(일\)/);
});

test('재참여 모집 폼의 선택 입력에는 예시가 없고 기존 후기 폼은 보존', () => {
  for (const path of [PAGE]) {
    const html = readFileSync(new URL('../public' + path + 'index.html', import.meta.url), 'utf8');
    const wish = html.match(/<textarea\b[^>]*name="sv_wish"[^>]*>/)?.[0];
    assert.ok(wish, path);
    assert.doesNotMatch(wish, /placeholder="[^"]+"/, path);
    assert.match(html, /다음 기수에 바라는 점.*?선택/);
    assert.match(html, /방 구성이나 진행 방식에 바라는 점이 있다면 적어주세요\./);
  }
  const existing = readFileSync(new URL('../public/rejoin/7/seoul/index.html', import.meta.url), 'utf8');
  assert.match(existing, /<textarea\b[^>]*name="sv_wish"[^>]*placeholder="예\)/);
});

test('재참여 모집은 승인된 담백한 문구와 신청 버튼을 표시', () => {
  const html = readFileSync(new URL('../public' + PAGE + 'index.html', import.meta.url), 'utf8');
  assert.match(html, /<h1 class="sv-h1">서울 9기 재참여 신청<\/h1>/);
  assert.match(html, /기존 참가자는 2,000원 할인된 5,900원으로 신청하실 수 있습니다\./);
  assert.match(html, /참여할 일정을 선택해 주세요\./);
  assert.match(html, /id="submit">재참여 신청하기<\/button>/);
  assert.doesNotMatch(html, /다시 함께할 3일, 골라볼까요\?|편한 일정을 골라 재참여 할인가로 신청해 주세요\./);
  assert.doesNotMatch(html, /btn\.textContent='제출하기'/);
});
