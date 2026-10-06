import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';
import { COHORT_DEADLINE, cohortStatus } from '../shared/cohort.mjs';
import { FESTIVAL_DEADLINE } from '../shared/jnu-festival.mjs';

const deadline = Date.parse(COHORT_DEADLINE);
const fields = Object.fromEntries(['gender', 'birth_year', 'school', 'source', 'device', 'phone', 'consent', 'name'].map((k) => [k, 'test']));
const submit = (env, body) => onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify(body) }), params: { path: ['submit'] }, env });
async function at(ms, fn) { const o = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = o; } }

test('3기 deadline is 2026-10-06 00:00 KST and env COHORT_DEADLINE overrides it', () => {
  assert.equal(new Date(deadline).toISOString(), '2026-10-05T15:00:00.000Z');
  assert.equal(cohortStatus(deadline - 1).open, true);
  assert.equal(cohortStatus(deadline).open, false);
  assert.equal(cohortStatus(deadline - 1, { COHORT_DEADLINE: '2026-09-01T00:00:00+09:00' }).open, false);
  assert.equal(cohortStatus(deadline + 1, { COHORT_DEADLINE: String(deadline + 10) }).open, true);
});

test('GET /api/cohort reports closed after the deadline and never caches', async () => {
  const res = await at(deadline + 1, () => onRequest({ request: new Request('http://localhost/api/cohort'), params: { path: ['cohort'] }, env: {} }));
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const s = await res.json();
  assert.equal(s.open, false); assert.equal(s.deadline, deadline); assert.equal(s.serverNow, deadline + 1);
});

test('after the deadline every cohort form (regular, early, discount, both cities) gets 409 cohort_closed and nothing is stored', async () => {
  const cases = [];
  for (const city of ['seoul', 'gwangju']) {
    cases.push([`/${city}/`, 'regular'], [`/${city}/pre-4k9x/`, 'early'], [`/${city}/discount-4900/`, 'discount']);
  }
  for (const [path, plan] of cases) {
    const writes = [];
    const env = { APPLY_KV: { put: async (k, v) => writes.push([k, v]) } };
    const res = await at(deadline, () => submit(env, { fields, path, hidden: { city: path.split('/')[1], plan } }));
    assert.equal(res.status, 409, path);
    assert.equal((await res.json()).error, 'cohort_closed', path);
    assert.equal(writes.length, 0, path);
  }
});

test('one millisecond before the deadline a regular submission is still accepted', async () => {
  const writes = [];
  const env = { APPLY_KV: { put: async (k, v) => writes.push([k, v]) } };
  const res = await at(deadline - 1, () => submit(env, { fields, path: '/seoul/', hidden: { city: 'seoul', plan: 'regular' } }));
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(writes[0][1]).hidden.plan, 'regular');
});

test('festival form keeps its own (earlier) deadline: still festival_closed, not cohort_closed', async () => {
  const res = await at(deadline + 1, () => submit({ APPLY_KV: { put: async () => {} } }, { fields, path: '/jnu-festival/', hidden: { city: 'gwangju', plan: 'jnu_festival' } }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'festival_closed');
  assert.ok(Date.parse(FESTIVAL_DEADLINE) < deadline);
});
