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
  assert.match(s.loc, /^\/6\/seoul\/\?/);   // 10/14: 6기로 넘김
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
  // 실제 등록부: 5기(10/14 18:00 마감)와 6기(10/18 18:00 마감)가 같은 고정 링크
  assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-14T17:59:00+09:00')), '/5/seoul/');
  assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-14T18:01:00+09:00')), '/6/seoul/');
  // 10/18: 7기(10/21 18:00 마감)를 올려도 g 없음/여자는 6기 마감 전까진 6기, 남자는 바로 7기. 6기 마감 뒤엔 모두 7기
  const before6 = Date.parse('2026-10-18T17:59:00+09:00'), after6 = Date.parse('2026-10-18T18:01:00+09:00');
  assert.equal(entryTarget('/seoul/student/', before6), '/6/seoul/');
  assert.equal(entryTarget('/seoul/student/', before6, undefined, 'f'), '/6/seoul/');
  assert.equal(entryTarget('/seoul/student/', before6, undefined, 'm'), '/7/seoul/');
  assert.equal(entryTarget('/seoul/student/', after6), '/7/seoul/');
  assert.equal(entryTarget('/seoul/student/', after6, undefined, 'f'), '/7/seoul/');
  assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-21T18:01:00+09:00'), undefined, 'm'), '/7/seoul/');   // 7기도 닫히면 마감 안내
  // 8기, 9기 미리 올려 둠 (10/21): 7기 마감(10/22 18:00) 전엔 7기, 뒤엔 8기, 8기 마감(10/29 18:00) 뒤엔 9기, 9기 마감(11/5 18:00) 뒤엔 9기 마감 안내. 남녀 같음
  for (const g of ['', 'm', 'f']) {
    assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-22T17:59:59+09:00'), undefined, g), '/7/seoul/', g);
    assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-22T18:00:00+09:00'), undefined, g), '/8/seoul/', g);
    assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-29T17:59:59+09:00'), undefined, g), '/8/seoul/', g);
    assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-29T18:00:00+09:00'), undefined, g), '/9/seoul/', g);
    assert.equal(entryTarget('/seoul/student/', Date.parse('2026-11-05T18:00:00+09:00'), undefined, g), '/9/seoul/', g);
  }
});

test('고정 링크: 6기 마감 전 남자 광고(src 의 m 또는 g=m)는 7기, 여자 광고와 바이오는 6기 (10/18)', async () => {
  const o = Date.now; Date.now = () => Date.parse('2026-10-18T15:00:00+09:00');
  try {
    assert.match((await go('/seoul/student/', '?src=ad-seoul-m-exhibit-2137')).loc, /^\/7\/seoul\/\?src=ad-seoul-m-exhibit-2137&g=m$/);
    assert.match((await go('/seoul/student/', '?g=m')).loc, /^\/7\/seoul\/\?g=m$/);
    assert.match((await go('/seoul/student/', '?src=ad-seoul-f-exhibit-1360')).loc, /^\/6\/seoul\/\?/);
    assert.equal((await go('/seoul/student/', '?src=h6-seoul-insta-bio')).loc, '/6/seoul/?src=h6-seoul-insta-bio');
    const { onRequest } = await import('../functions/_middleware.js');
    const hit = async (u) => { const r = await onRequest({ request: new Request('https://join.haruharu.co.kr' + u), env: {}, next: async () => new Response('page') }); return [r.status, r.headers.get('location')]; };
    assert.deepEqual(await hit('/5/seoul/?src=ad-seoul-m-film-2137'), [302, '/7/seoul/?src=ad-seoul-m-film-2137&g=m']);   // 옛 기수 남자 광고 주소도 7기
    assert.deepEqual(await hit('/5/seoul/?src=ad-seoul-f-film-1360'), [302, '/7/seoul/?src=ad-seoul-f-film-1360&g=f']);   // 지금 기수 7기 (6기 마감 뒤 병합)
    assert.equal((await hit('/6/seoul/?g=m'))[0], 200);   // 열린 6기 폼에 직접 온 건 그대로
  } finally { Date.now = o; }
});

test('마감된 앞 기수 정가 폼은 지금 기수(6기) 서울 폼으로 302, 광주는 6기가 없어 마감 안내, 할인/재참여는 그대로', async () => {
  const { onRequest } = await import('../functions/_middleware.js');
  const o = Date.now; Date.now = () => Date.parse('2026-10-10T18:00:00+09:00');
  const hit = async (u) => { const r = await onRequest({ request: new Request('https://join.haruharu.co.kr' + u), env: {}, next: async () => new Response('page') }); return [r.status, r.headers.get('location')]; };
  try {
    assert.deepEqual(await hit('/4/seoul/?src=h4t-stu-m-bike'), [302, '/7/seoul/?src=h4t-stu-m-bike&g=m']);   // 10/18: 남자는 7기 먼저
    assert.deepEqual(await hit('/4/seoul/v2/?src=h4t-stu-f-ieum'), [302, '/7/seoul/?src=h4t-stu-f-ieum&g=f']);   // 지금 기수 7기
    assert.equal((await hit('/4/gwangju/'))[0], 200);
    assert.deepEqual(await hit('/seoul/'), [302, '/7/seoul/']);
    assert.equal((await hit('/4/seoul/x7q2/'))[0], 200);
    assert.equal((await hit('/4/seoul/rejoin/'))[0], 200);
    assert.equal((await hit('/4/seoul-work/pre/'))[0], 200);
    assert.equal((await hit('/5/seoul/'))[0], 200);
  } finally { Date.now = o; }
});
