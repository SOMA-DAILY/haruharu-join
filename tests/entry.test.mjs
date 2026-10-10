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
  assert.match(s.loc, /^\/5\/seoul\/v2\/\?/);
  assert.match(s.loc, /src=h5-stu-f-ieum/); assert.match(s.loc, /fbclid=abc/); assert.match(s.loc, /g=f/);
  assert.match((await go('/gwangju/student/')).loc, /^\/5\/gwangju\/v2\/$/);
});

test('고정 링크: 직장인은 4기 사전알림 그대로, 4기 마감 뒤에도 열림', async () => {
  assert.equal((await go('/seoul/work/', '?src=x')).loc, '/4/seoul-work/pre/?src=x');
  const after = Date.parse('2026-10-12T00:00:00+09:00');
  assert.equal(formStatus('/4/seoul-work/pre/', after).open, true);
  assert.equal(formStatus('/4/seoul/', after).open, false);
});

test('다음 기수를 미리 올려도 앞 기수 마감 전까진 앞 기수, 마감 뒤엔 다음 기수', () => {
  FORMS['/6/seoul/v2/'] = { ...FORMS['/5/seoul/v2/'], cohort: '6', label: '6기 시험' };
  const env = { COHORT_DEADLINE: '2026-11-01T00:00:00+09:00' };   // 현재 기수(5) 마감 시험값
  assert.equal(entryTarget('/seoul/student/', Date.parse('2026-10-31T23:00:00+09:00'), env), '/5/seoul/v2/');
  assert.equal(entryTarget('/seoul/student/', Date.parse('2026-11-01T01:00:00+09:00'), env), '/6/seoul/v2/');
  delete FORMS['/6/seoul/v2/'];
});

test('마감된 4기 폼의 다음 링크는 5기 개선판', () => {
  assert.equal(formStatus('/4/seoul/', Date.parse('2026-10-12T00:00:00+09:00')).next, '/5/seoul/v2/');
});
