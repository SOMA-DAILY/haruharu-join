import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

// 메타 광고 검토 크롤러: fbclid + facebook.com 리퍼러 + 인앱 아닌 UA → is_bot=1, /capi 거부
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G90 Instagram 400.1.0.35.61';

function env() {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0008_track_schedule.sql']) sql.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const conv = (q) => q.replace(/\?(\d+)/g, '?$1');
  const st = (q) => sql.prepare(conv(q));
  const DB = {
    prepare(q) { return { bind(...a) { return { q, a, all: async () => ({ results: st(q).all(...a) }), first: async () => st(q).get(...a), run: async () => st(q).run(...a) }; } }; },
    async batch(list) { for (const x of list) st(x.q).run(...x.a); return []; },
  };
  return { sql, env: { DB, APPLY_KV: { get: async () => null, put: async () => {}, delete: async () => {} } } };
}
async function visit(e, sid, ua, ref, fbclid) {
  const body = { sid, path: '/5/seoul/', page: 1, fields: {}, hidden: { city: 'seoul', cohort: '5', plan: 'regular', src: 'ad-x', ...(fbclid ? { fbclid: 'abc' } : {}) }, ua, ref };
  await onRequest({ request: new Request('http://localhost/api/partial', { method: 'POST', headers: { 'user-agent': ua }, body: JSON.stringify(body) }), params: { path: ['partial'] }, env: e.env, waitUntil() {} });
  return e.sql.prepare('SELECT is_bot FROM sessions WHERE sid = ?').get(sid).is_bot;
}

test('검토 크롤러 패턴은 봇', async () => {
  const e = env();
  assert.equal(await visit(e, 's1', WIN, 'https://www.facebook.com/', true), 1);
  assert.equal(await visit(e, 's2', WIN, 'http://m.facebook.com', true), 1);
});

test('인스타 인앱, fbclid 없음, 다른 리퍼러는 사람', async () => {
  const e = env();
  assert.equal(await visit(e, 's3', IG, 'https://www.facebook.com/', true), 0);
  assert.equal(await visit(e, 's4', WIN, 'https://www.facebook.com/', false), 0);
  assert.equal(await visit(e, 's5', WIN, 'https://instagram.com/', true), 0);
  assert.equal(await visit(e, 's6', WIN, 'https://notfacebook.com.evil.kr/', true), 0);
});

test('/capi 는 검토 크롤러 거부', async () => {
  const e = env();
  const call = (ua, ref) => onRequest({ request: new Request('http://localhost/api/capi', { method: 'POST', headers: { 'user-agent': ua }, body: JSON.stringify({ event_name: 'LandingEngaged', event_id: 'x', path: '/5/seoul/', url: 'https://join.haruharu.co.kr/5/seoul/?fbclid=abc', ref }) }), params: { path: ['capi'] }, env: e.env, waitUntil() {} });
  assert.equal((await call(WIN, 'https://www.facebook.com/')).status, 400);
  assert.equal((await call(IG, 'https://www.facebook.com/')).status, 200);
});
