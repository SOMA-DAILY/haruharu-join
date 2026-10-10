import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';

const ID = '11111111-2222-3333-4444-555555555555';
function env(row = { kv_key: 's:20261010-111' }) {
  const store = new Map([['s:20261010-111', JSON.stringify({ id: ID })]]), runs = [];
  const DB = { prepare: (sql) => ({ bind: (...a) => ({ first: async () => (/SELECT kv_key/.test(sql) ? row : null), run: async () => { runs.push([sql, a]); return {}; } }) }) };
  const APPLY_KV = { get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => { store.set(k, v); } };
  return { env: { DB, APPLY_KV }, store, runs };
}
const post = (e, body) => onRequest({ request: new Request('http://localhost/api/experience', { method: 'POST', body: JSON.stringify(body) }), params: { path: ['experience'] }, env: e });

test('완료 화면 선택 문항: 신청서 KV 와 D1 에 저장, 한 번만', async () => {
  const t = env();
  assert.equal((await post(t.env, { id: ID, methods: ['friend_intro', 'setlog_haruharu', 'hack'] })).status, 200);
  assert.equal(JSON.parse(t.store.get('s:20261010-111')).dating_experience, 'friend_intro,setlog_haruharu');
  assert.deepEqual(t.runs[0][1], [ID, 'friend_intro,setlog_haruharu']);
  await post(t.env, { id: ID, methods: ['none'] });
  assert.equal(JSON.parse(t.store.get('s:20261010-111')).dating_experience, 'friend_intro,setlog_haruharu');
});

test('없는 신청, 이상한 ID, 빈 값은 저장 안 함', async () => {
  assert.equal((await post(env(null).env, { id: ID, methods: ['none'] })).status, 404);
  assert.equal((await post(env().env, { id: 'x', methods: ['none'] })).status, 400);
  assert.equal((await post(env().env, { id: ID, methods: ['nope'] })).status, 400);
});
