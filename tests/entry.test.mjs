import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryHandler } from '../shared/entry.mjs';
import { entryTarget, formStatus, FORMS } from '../shared/forms.mjs';

async function go(entry, qs = '') {
  const request = new Request(`https://join.haruharu.co.kr${entry}${qs}`);
  const res = await entryHandler(entry)({ request, env: {} });
  return { status: res.status, loc: res.headers.get('location') || '' };
}

test('고정 링크: 서울/광주 학생은 지금 기수 개선판으로, 쿼리 그대로 + 광고 성별', async () => {
  const s = await go('/seoul/student/', '?src=h5-stu-f-ieum&fbclid=abc');
  assert.equal(s.status, 302);
  assert.match(s.loc, /^\/5\/seoul\/\?/);
  assert.match(s.loc, /src=h5-stu-f-ieum/); assert.match(s.loc, /fbclid=abc/); assert.match(s.loc, /g=f/);
  assert.match((await go('/gwangju/student/')).loc, /^\/5\/gwangju\/$/);
});

test('고정 링크: 직장인은 4기 사전알림 그대로, 4기 마감 뒤에도 열림', async () => {
  assert.equal((await go('/seoul/work/', '?src=x')).loc, '/4/seoul-work/pre/?src=x');
  const after = Date.parse('2026-10-12T00:00:00+09:00');
  assert.equal(formStatus('/4/seoul-work/pre/', after).open, true);
  assert.equal(formStatus('/4/seoul/', after).open, false);
});

test('다음 기수를 미리 올려도 앞 기수 마감 전까진 앞 기수, 마감 뒤엔 다음 기수', () => {
  FORMS['/6/seoul/'] = { ...FORMS['/5/seoul/'], cohort: '6', label: '6기 시험' };
  const env = { COHORT_DEADLINE: '2026-11-01T00:00:00+09:00' };   // 현재 기수(5) 마감 시험값
  assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-31T23:00:00+09:00'), env), '/5/seoul/');
  assert.equal(entryTarget('/seoul/student/', Date.parse('2026-11-01T01:00:00+09:00'), env), '/6/seoul/');
  delete FORMS['/6/seoul/'];
});

test('마감된 4기 정가 폼은 5기 폼으로 302, 할인/재참여는 그대로', async () => {
  const { onRequest } = await import('../functions/_middleware.js');
  const o = Date.now; Date.now = () => Date.parse('2026-10-10T18:00:00+09:00');
  const hit = async (u) => { const r = await onRequest({ request: new Request('https://join.haruharu.co.kr' + u), env: {}, next: async () => new Response('page') }); return [r.status, r.headers.get('location')]; };
  try {
    assert.deepEqual(await hit('/4/seoul/?src=h4t-stu-m-bike'), [302, '/5/seoul/?src=h4t-stu-m-bike&g=m']);
    assert.deepEqual(await hit('/4/seoul/v2/?src=h4t-stu-f-ieum'), [302, '/5/seoul/?src=h4t-stu-f-ieum&g=f']);
    assert.deepEqual(await hit('/4/gwangju/'), [302, '/5/gwangju/']);
    assert.deepEqual(await hit('/seoul/'), [302, '/5/seoul/']);
    assert.equal((await hit('/4/seoul/x7q2/'))[0], 200);
    assert.equal((await hit('/4/seoul/rejoin/'))[0], 200);
    assert.equal((await hit('/4/seoul-work/pre/'))[0], 200);
    assert.equal((await hit('/5/seoul/'))[0], 200);
  } finally { Date.now = o; }
});
