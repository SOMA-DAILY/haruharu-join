import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].js';

// 링크 목록: 기수로 볼 때 랜딩(/) 방문은 land_from~land_to 안의 것만 섞임
async function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE sessions(src TEXT, path TEXT, first_ts INTEGER, is_bot INTEGER DEFAULT 0);
    CREATE TABLE links(src TEXT PRIMARY KEY, path TEXT, label TEXT, channel TEXT, note TEXT, archived INTEGER DEFAULT 0, created_at INTEGER);`);
  const ins = sql.prepare('INSERT INTO sessions(src, path, first_ts) VALUES (?, ?, ?)');
  ins.run('old-root', '/', 100);      // 4기 기간 랜딩
  ins.run('new-root', '/', 300);      // 5기 기간 랜딩
  ins.run('h5-form', '/5/seoul/', 300);
  ins.run('h4-form', '/4/seoul/', 100);
  const store = new Map();
  const conv = (q) => q.replace(/\?\d+/g, '?');
  const env = {
    ADMIN_PASSWORD: 'local-test', ADMIN_SESSION_SECRET: 'local-secret',
    APPLY_KV: { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => store.set(k, v), delete: async (k) => store.delete(k) },
    DB: { prepare(q) { const st = () => sql.prepare(conv(q)); return { bind(...a) { return { all: async () => ({ results: st().all(...a) }), first: async () => st().get(...a), run: async () => st().run(...a) }; }, all: async () => ({ results: st().all() }) }; } },
  };
  const login = await onRequest({ request: new Request('http://localhost/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'local-test' }) }), params: { path: ['admin', 'login'] }, env });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return async (qs) => {
    const r = await onRequest({ request: new Request('http://localhost/api/admin/links?' + qs, { headers: { cookie } }), params: { path: ['admin', 'links'] }, env });
    return (await r.json()).rows.map((x) => x.src).sort();
  };
}

test('지난 기수: 그 기수 기간의 랜딩 방문만', async () => {
  const get = await fixture();
  assert.deepEqual(await get('paths=/4/seoul/&land=/&land_to=200'), ['h4-form', 'old-root']);
});

test('현재 기수: 직전 마감 뒤 랜딩 방문만', async () => {
  const get = await fixture();
  assert.deepEqual(await get('paths=/5/seoul/&land=/&land_from=200'), ['h5-form', 'new-root']);
});

test('land 없으면 폼 경로만', async () => {
  const get = await fixture();
  assert.deepEqual(await get('paths=/5/seoul/'), ['h5-form']);
});
