import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';
import { capacityGroups, capacityStatus } from '../shared/capacity.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sql.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  const data = new Map();
  let dbFailure = false, kvFailure = false;
  let queue = Promise.resolve();
  const DB = {
    prepare(query) {
      let args = [];
      const run = method => {
        if (dbFailure) throw Error('database unavailable');
        const stmt = sql.prepare(query.replace(/\?(\d+)/g, (_, n) => '$p' + n));
        const values = Object.fromEntries(args.map((v, i) => ['p' + (i + 1), v]));
        return args.length ? stmt[method](values) : stmt[method]();
      };
      return { bind(...a) { args = a; return this; }, async first() { return run('get') || null; }, async all() { return { results: run('all') }; }, async run() { return { meta: run('run') }; } };
    },
    batch(statements) {
      const work = queue.then(async () => {
        sql.exec('BEGIN');
        try { const rows = []; for (const stmt of statements) rows.push(await stmt.run()); sql.exec('COMMIT'); return rows; }
        catch (e) { sql.exec('ROLLBACK'); throw e; }
      });
      queue = work.catch(() => {});
      return work;
    },
  };
  const env = { DB, COHORT_DEADLINE: '2099-01-01', ADMIN_PASSWORD: 'local-test', ADMIN_SESSION_SECRET: 'local-secret',
    APPLY_KV: { async get(key, type) { const v = data.get(key); return type === 'json' && typeof v === 'string' ? JSON.parse(v) : v || null; }, async put(key, v) { if (kvFailure) throw Error('KV unavailable'); data.set(key, v); }, async delete(key) { data.delete(key); } } };
  let cookie = '';
  async function call(path, body, auth = true, origin = 'http://localhost') {
    const [pathname, qs = ''] = path.split('?');
    return onRequest({ request: new Request('http://localhost/api/' + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(auth ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), params: { path: pathname.split('/') }, env, waitUntil() {} });
  }
  async function login() { const r = await call('admin/login', { password: 'local-test' }); cookie = r.headers.get('set-cookie').split(';')[0]; }
  async function set(male = 2, female = 2) { await login(); return call('admin/capacities', { cohort: '8', track: 'seoul-student', male_limit: male, female_limit: female }); }
  let seq = 0;
  function submit(gender = '남성', extra = {}) {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(++seq).padStart(12, '0');
    return call('submit', { sid: id, path: '/8/seoul/', fields: { gender, birth_year: '2003', school: '가상대', phone: '01000000001', consent: '동의합니다', name: '로컬 확인', device: 'iPhone', source: '인스타그램', ...extra.fields }, ...extra });
  }
  return { sql, env, data, call, set, submit, login, failDB(v) { dbFailure = v; }, failKV(v) { kvFailure = v; } };
}

test('limits require authenticated same-origin admin and validated integers', async () => {
  const f = fixture();
  const body = { cohort: '8', track: 'seoul-student', male_limit: 20, female_limit: 20 };
  assert.equal((await f.call('admin/capacities', body, false)).status, 401);
  await f.login();
  assert.equal((await f.call('admin/capacities', body, true, 'https://other.example')).status, 403);
  for (const value of [-1, 1.5, '20', 10001, true]) assert.equal((await f.set(value)).status, 400);
  assert.equal((await f.set()).status, 200);
  const groups = (await (await f.call('admin/capacities')).json()).rows;
  assert.equal(groups.find(x => x.cohort === '8').male_limit, 2);
});
test('last male seat closes only men, every entry path shares capacity, cancellation reopens it', async () => {
  const f = fixture(); await f.set(1, 2);
  assert.equal((await f.submit()).status, 200);
  const full = await f.submit(); assert.equal(full.status, 409); assert.equal((await full.json()).error, 'cohort_full');
  assert.equal((await f.submit('여성')).status, 200);
  for (const path of capacityGroups().find(g => g.cohort === '8').paths) assert.equal((await capacityStatus(f.env, path, Date.now(), 'm')).open, false, path);
  assert.equal((await capacityStatus(f.env, '/9/seoul/', Date.now(), 'm')).open, true);
  f.sql.exec("UPDATE submissions SET status = '취소' WHERE gender = '남성'");
  assert.equal((await capacityStatus(f.env, '/8/seoul/', Date.now(), 'm')).open, true);
  assert.equal((await f.submit()).status, 200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n, 3);
});
test('database trigger rejects another insert after concurrent final-seat reads, before KV is written', async () => {
  const f = fixture(); await f.set(1, 20);
  const results = await Promise.all([f.submit(), f.submit()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n, 1);
  assert.equal([...f.data.keys()].filter(k => k.startsWith('s:')).length, 1);
});
test('zero closes immediately, null removes the limit, existing counts are preserved when lowering limits', async () => {
  const f = fixture(); assert.equal((await f.submit()).status, 200); await f.set(0, null);
  assert.equal((await f.submit()).status, 409); assert.equal((await f.submit('여성')).status, 200);
  await f.set(null, null); assert.equal((await f.submit()).status, 200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n, 3);
});

test('male phone-only rejoin shares capacity and can select the other cohort at the same discount', async () => {
  const f=fixture();await f.set(0,null);
  const path='/8/seoul/rejoin/men/';
  const blocked=await f.submit('남성',{path,fields:{phone:'01000000001',name:'이번 송금자'}});
  assert.equal(blocked.status,409);assert.equal((await blocked.json()).error,'cohort_full');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n,0);
  const next=await f.submit('남성',{path,fields:{phone:'01000000001',name:'이번 송금자',cohort_pick:'9',buddy_room:'같은 방',buddy:'01000000002'}});
  assert.equal(next.status,200);
  const saved=f.sql.prepare('SELECT cohort,path,plan,gender,name,buddy,buddy_room FROM submissions').get();
  assert.equal(saved.cohort,'9');assert.equal(saved.path,'/9/seoul/rejoin/men/');
  assert.equal(saved.plan,'discount');assert.equal(saved.gender,'남성');
  assert.equal(saved.name,'이번 송금자');assert.equal(saved.buddy,'01000000002');assert.equal(saved.buddy_room,'같은 방');
});
test('only pending/payment-confirmed applications count and public responses omit counts and limits', async () => {
  const f = fixture(); await f.set(20, 20);
  for (const status of ['', '송금확인', '송금확인 안됨', '확정', '취소', '연락함', '보류']) { await f.submit(); f.sql.prepare('UPDATE submissions SET status = ? WHERE application_id = (SELECT application_id FROM submissions ORDER BY rowid DESC LIMIT 1)').run(status); }
  const rows = (await (await f.call('admin/capacities')).json()).rows;
  assert.equal(rows.find(x => x.cohort === '8').counts.male, 2);
  const st = await (await f.call('cohort?path=/8/seoul/&g=m')).json();
  assert.equal(st.open, true); assert.equal(st.capacityEnabled, true); assert.ok(!('counts' in st)); assert.ok(!('male_limit' in st));
});
test('capacity-controlled submissions fail closed on DB outage, while KV outage still allows a D1 receipt', async () => {
  const f = fixture(); await f.set(20, 20); f.failDB(true);
  assert.equal((await f.submit()).status, 503); assert.equal([...f.data.keys()].filter(k => k.startsWith('s:')).length, 0);
  f.failDB(false); f.failKV(true); assert.equal((await f.submit()).status, 200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n, 1);
});
test('retries at capacity retain one seat and paid status; selected cohort and actual returning gender are enforced', async () => {
  const f = fixture(); await f.set(1, 20);
  const sid = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
  assert.equal((await f.submit('남성', { sid })).status, 200);
  f.sql.exec("UPDATE submissions SET status = '송금확인'");
  assert.equal((await f.submit('남성', { sid })).status, 200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n, 1);
  assert.equal(f.sql.prepare('SELECT status FROM submissions').get().status, '송금확인');
  const r = await f.submit('여성', { path: '/8/seoul/rejoin/returning/', hidden: { g: 'f' }, fields: { phone: '01000000001', name: '가상 재신청' } });
  assert.equal(r.status, 409);
  assert.equal((await f.submit('남성', { path: '/9/seoul/', fields: { gender: '남성', birth_year: '2003', school: '가상대', phone: '01000000001', consent: '동의합니다', name: '가상', device: 'iPhone', source: '인스타그램', cohort_pick: '8' } })).status, 409);
});
test('missing returning gender requires an explicit answer; stored profile overrides a conflicting answer', async () => {
  const f = fixture(); await f.set(0, 2);
  const path = '/8/seoul/rejoin/returning/';
  const fields = { phone: '01000000003', name: '가상 신규 기록' };
  const unknown = await f.submit('', { path, fields });
  assert.equal(unknown.status, 400); assert.equal((await unknown.json()).error, 'gender_required');
  assert.equal((await f.submit('', { path, fields: { ...fields, gender: '여성' } })).status, 200);
  assert.equal(f.sql.prepare('SELECT gender FROM submissions').get().gender, '여성');
  f.sql.exec("UPDATE submissions SET gender='남성'");
  assert.equal((await f.submit('', { path, fields: { ...fields, gender: '여성' } })).status, 409);
});
test('track-based atomic guard covers a new form path and excludes free alerts', async () => {
  const f = fixture(); await f.set(1, 2); await f.submit();
  assert.throws(() => f.sql.prepare("INSERT INTO submissions(application_id,path,cohort,track,gender,status,plan) VALUES('new-path','/8/seoul/new/','8','seoul-student','남성','','regular')").run(), /cohort_capacity_full/);
  f.sql.prepare("INSERT INTO submissions(application_id,path,cohort,track,gender,status,plan) VALUES('free-alert','/8/seoul/pre/','8','seoul-student','남성','','prealert')").run();
  assert.equal((await (await f.call('admin/capacities')).json()).rows.find(x => x.cohort === '8').counts.male, 1);
});
test('unselected-gender availability ignores a previous gender cookie and closes only when both genders are full', async () => {
  const f = fixture(); await f.set(0, 2);
  async function state(g) {
    const res = await onRequest({ request: new Request('http://localhost/api/capacity?paths=/8/seoul/&g=' + g, { headers: { cookie: 'hh_g=m' } }), params: { path: ['capacity'] }, env: f.env });
    assert.equal(res.status, 200); return (await res.json()).states['/8/seoul/'];
  }
  assert.equal((await state('m')).open, false);
  const undecided = await state('all');
  assert.equal(undecided.open, true); assert.deepEqual(undecided.available, { m: false, f: true });
  await f.set(0, 0);
  assert.equal((await state('all')).open, false);
});
