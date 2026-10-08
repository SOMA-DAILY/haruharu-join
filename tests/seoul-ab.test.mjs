import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/4/seoul/index.js';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram';
async function hit(src, cookie) {
  const headers = { 'user-agent': UA };
  if (cookie) headers.cookie = `hh_ab_4seoul=${cookie}`;
  const request = new Request(`https://join.haruharu.co.kr/4/seoul/?src=${src}`, { headers });
  const res = await onRequestGet({ request, next: async () => new Response('a-form') });
  const loc = res.headers.get('location') || '';
  return { form: res.status === 302 && loc.startsWith('/4/seoul/v2/') ? 'b' : 'a', loc, cookie: res.headers.get('set-cookie') || '' };
}

test('바이오: 쿠키 없으면 기존 폼, 배정 쿠키도 안 만듦', async () => {
  const r = await hit('h4-seoul-insta-bio');
  assert.equal(r.form, 'a'); assert.equal(r.cookie, '');
});

test('바이오: 광고로 b 배정된 쿠키가 있으면 개선판, src 그대로', async () => {
  const r = await hit('h4-seoul-insta-bio', 'b');
  assert.equal(r.form, 'b'); assert.match(r.loc, /src=h4-seoul-insta-bio/);
});

test('바이오: 광고로 a 배정된 쿠키면 기존 폼', async () => {
  assert.equal((await hit('h4-seoul-insta-bio', 'a')).form, 'a');
});

test('광고 링크: 쿠키대로 유지, 쿠키 없으면 반반 배정 + 쿠키', async () => {
  assert.equal((await hit('h4t-stu-m-school', 'b')).form, 'b');
  assert.equal((await hit('h4t-stu-m-school', 'a')).form, 'a');
  const seen = new Set();
  for (let i = 0; i < 60; i++) { const r = await hit('h4t-stu-m-school'); assert.match(r.cookie, /hh_ab_4seoul=[ab]/); seen.add(r.form); }
  assert.deepEqual([...seen].sort(), ['a', 'b']);
});
