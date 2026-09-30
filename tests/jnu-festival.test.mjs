import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].js';
import { readFileSync, readdirSync } from 'node:fs';
import { FESTIVAL_DEADLINE, CAPTURE_DELETE_AT, CAPTURE_MAX_BYTES, CAPTURE_FALLBACK_TTL_SEC, festivalStatus, decodeCapture, captureExpiration } from '../shared/jnu-festival.mjs';

const deadline = Date.parse(FESTIVAL_DEADLINE);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const dataUrl = (buf, type = 'image/jpeg') => `data:${type};base64,${buf.toString('base64')}`;
const SID = '11111111-2222-4333-8444-555555555555';
const fields = { gender: '여성', birth_year: '2003', major: '소프트웨어공학과', phone: '010-1234-5678', consent: '동의합니다', name: '홍길동', buddy_room: '같은 방', buddy: '010-2222-3333', avoid_same_major: '같은 과 피하기' };

function memKV() {
  const m = new Map(), meta = new Map(), opts = new Map();
  return {
    m, meta, opts,
    get: async (k, t) => { const v = m.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
    getWithMetadata: async (k) => ({ value: m.has(k) ? m.get(k) : null, metadata: meta.get(k) || null }),
    put: async (k, v, o) => { opts.set(k, o); m.set(k, typeof v === 'string' ? v : (v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v)); if (o && o.metadata) meta.set(k, o.metadata); },
    delete: async (k) => { m.delete(k); meta.delete(k); },
  };
}
const submit = (env, body) => onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify(body) }), params: { path: ['submit'] }, env });
const festBody = (over = {}) => ({ sid: SID, path: '/jnu-festival/', fields: { ...fields }, hidden: { city: 'gwangju', plan: 'jnu_festival' }, capture: dataUrl(JPEG), ...over });
async function at(ms, fn) { const o = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = o; } }

test('deadline is 2026-10-03 15:00 KST and can be overridden by env for local tests', () => {
  assert.equal(new Date(deadline).toISOString(), '2026-10-03T06:00:00.000Z');
  assert.equal(festivalStatus(deadline - 1).open, true);
  assert.equal(festivalStatus(deadline).open, false);
  assert.equal(festivalStatus(deadline - 1, { JNU_FESTIVAL_DEADLINE: '2026-09-01T00:00:00+09:00' }).open, false);
  assert.equal(festivalStatus(deadline + 1, { JNU_FESTIVAL_DEADLINE: String(deadline + 10) }).open, true);
});

test('valid festival submission stores the capture in KV img:{id} and the answers without the image', async () => {
  const kv = memKV();
  const res = await at(deadline - 1000, () => submit({ APPLY_KV: kv }, festBody()));
  assert.equal(res.status, 200);
  const { application_id } = await res.json();
  assert.equal(application_id, SID);
  assert.deepEqual(new Uint8Array(kv.m.get('img:' + SID)), new Uint8Array(JPEG));
  assert.equal(kv.meta.get('img:' + SID).type, 'image/jpeg');
  assert.equal(kv.opts.get('img:' + SID).expiration, Date.parse('2026-10-08T00:00:00+09:00') / 1000, '행사 끝나면 KV 만료로 자동 삭제');
  const sKey = [...kv.m.keys()].find((k) => k.startsWith('s:'));
  const rec = JSON.parse(kv.m.get(sKey));
  assert.equal(rec.fields.major, '소프트웨어공학과');
  assert.equal(rec.fields.avoid_same_major, '같은 과 피하기');
  assert.equal(rec.fields.buddy_room, '같은 방');
  assert.equal(rec.hidden.plan, 'jnu_festival');
  assert.equal(rec.student_card_key, 'img:' + SID);
  assert.ok(!JSON.stringify(rec).includes(JPEG.toString('base64')), 'KV 신청 기록에 이미지가 들어가면 안 됨');
});

test('rejects missing capture, missing major, fake image, oversize image; nothing is stored', async () => {
  const cases = [
    [festBody({ capture: undefined }), 400, 'missing', 'capture'],
    [festBody({ fields: { ...fields, major: '' } }), 400, 'missing', 'major'],
    [festBody({ capture: dataUrl(Buffer.from('this is plain text, not a jpeg')) }), 400, 'capture_invalid'],
    [festBody({ capture: 'data:text/plain;base64,aGVsbG8=' }), 400, 'capture_invalid'],
    [festBody({ capture: dataUrl(Buffer.concat([JPEG, Buffer.alloc(CAPTURE_MAX_BYTES)])) }), 413, 'capture_too_large'],
  ];
  for (const [body, status, error, missField] of cases) {
    const kv = memKV();
    const res = await at(deadline - 1000, () => submit({ APPLY_KV: kv }, body));
    const out = await res.json();
    assert.equal(res.status, status, error);
    assert.equal(out.error, error);
    if (missField) assert.ok(out.miss.includes(missField));
    assert.equal(kv.m.size, 0);
  }
  assert.equal(decodeCapture(dataUrl(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'image/png')).type, 'image/png');
});

test('after the deadline the server refuses festival submissions, even when plan is spoofed', async () => {
  for (const body of [festBody(), festBody({ hidden: { city: 'gwangju', plan: 'regular' } }), festBody({ path: '/gwangju/' })]) {
    const kv = memKV();
    const res = await at(deadline, () => submit({ APPLY_KV: kv }, body));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'festival_closed');
    assert.equal(kv.m.size, 0);
  }
  const kv = memKV();
  const early = await at(deadline - 1000, () => submit({ APPLY_KV: kv, JNU_FESTIVAL_DEADLINE: String(deadline - 2000) }, festBody()));
  assert.equal(early.status, 409);
});

test('regular Gwangju form keeps its old required fields and never writes an image key', async () => {
  const kv = memKV();
  const reg = { gender: '남성', birth_year: '2002', school: '전남대학교', source: '인스타그램 광고', device: 'iPhone', phone: '010-9999-8888', consent: '동의합니다', name: '김철수' };
  const bad = await at(deadline + 1, () => submit({ APPLY_KV: kv }, { sid: SID, path: '/gwangju/', fields: { ...reg, source: '' }, hidden: { city: 'gwangju', plan: 'regular' } }));
  assert.equal(bad.status, 400);
  const ok = await at(deadline + 1, () => submit({ APPLY_KV: kv }, { sid: SID, path: '/gwangju/', fields: reg, hidden: { city: 'gwangju', plan: 'regular' }, capture: dataUrl(JPEG) }));
  assert.equal(ok.status, 200);
  assert.ok(![...kv.m.keys()].some((k) => k.startsWith('img:')));
});

test('/api/partial never stores the capture even if a client sends it inside fields', async () => {
  const binds = [];
  const DB = { prepare: () => ({ bind: (...a) => { binds.push(a); return {}; } }), batch: async () => [] };
  const body = { sid: SID, path: '/jnu-festival/', page: 2, fields: { major: '경영학과', capture: dataUrl(JPEG), student_card_key: 'img:x' }, hidden: { city: 'gwangju', plan: 'jnu_festival' } };
  const res = await onRequest({ request: new Request('http://localhost/api/partial', { method: 'POST', body: JSON.stringify(body) }), params: { path: ['partial'] }, env: { APPLY_KV: memKV(), DB } });
  assert.equal(res.status, 200);
  assert.equal(binds[0][1], '전남대 축제 신청폼');
  const stored = binds[1].find((v) => typeof v === 'string' && v.startsWith('{'));
  assert.deepEqual(JSON.parse(stored), { major: '경영학과' });
});

test('capture is served only with the admin cookie, and deleting the applicant deletes it', async () => {
  const kv = memKV();
  await kv.put('img:' + SID, new Uint8Array(JPEG), { metadata: { type: 'image/jpeg' } });
  await kv.put('s:1-' + SID.slice(0, 8), JSON.stringify({ application_id: SID }));
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE submissions(application_id TEXT PRIMARY KEY, kv_key TEXT);CREATE TABLE sessions(application_id TEXT);');
  sql.prepare('INSERT INTO submissions VALUES (?,?)').run(SID, 's:1-' + SID.slice(0, 8));
  const DB = { prepare(q) { return { bind(...a) { return { first: async () => sql.prepare(q.replace(/\?\d+/g, '?')).get(...a), run: () => sql.prepare(q.replace(/\?\d+/g, '?')).run(...a) }; } }; }, async batch(st) { for (const s of st) s.run(); } };
  const env = { APPLY_KV: kv, DB, ADMIN_PASSWORD: 'local-test', ADMIN_SESSION_SECRET: 'local-secret' };
  const call = (p, init = {}) => onRequest({ request: new Request('http://localhost/api/admin/' + p, init), params: { path: ['admin', ...p.split('?')[0].split('/')] }, env });
  assert.equal((await call('capture?id=' + SID)).status, 401);
  const login = await call('login', { method: 'POST', body: JSON.stringify({ password: 'local-test' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const img = await call('capture?id=' + SID, { headers: { cookie } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), new Uint8Array(JPEG));
  assert.equal((await call('capture?id=../../etc', { headers: { cookie } })).status, 400);
  assert.equal((await call('capture?id=00000000-0000-4000-8000-000000000000', { headers: { cookie } })).status, 404);
  const del = await call('applicants', { method: 'DELETE', headers: { cookie, origin: 'http://localhost' }, body: JSON.stringify({ id: SID, confirm: SID }) });
  assert.equal(del.status, 200);
  assert.ok(!kv.m.has('img:' + SID));
  assert.equal((await call('capture?id=' + SID, { headers: { cookie } })).status, 404);
});

test('capture size cap is 2MB and a normal-size capture (1.5MB) still passes', async () => {
  assert.equal(CAPTURE_MAX_BYTES, 2 * 1024 * 1024);
  const ok = decodeCapture(dataUrl(Buffer.concat([JPEG, Buffer.alloc(1.5 * 1024 * 1024)])));
  assert.equal(ok.type, 'image/jpeg');
  assert.equal(decodeCapture(dataUrl(Buffer.concat([JPEG, Buffer.alloc(CAPTURE_MAX_BYTES)]))).error, 'capture_too_large');
});

test('capture always gets a KV expiration, even if the deadline is moved past the delete date', () => {
  const del = Date.parse(CAPTURE_DELETE_AT);
  assert.ok(deadline < del, '마감이 캡처 삭제 시각보다 앞이어야 함');
  assert.equal(captureExpiration(deadline), del / 1000);
  for (const now of [del - 60 * 1000, del, del + 86400e3]) {
    const exp = captureExpiration(now);
    assert.ok(Number.isFinite(exp) && exp >= Math.floor(now / 1000) + 60, 'KV 최소 60초 뒤');
    assert.ok(exp <= Math.floor(now / 1000) + CAPTURE_FALLBACK_TTL_SEC, '늦게 들어와도 3일 안에 지움');
  }
});

// /api/export CSV 는 시트 IMPORTDATA 가 열 위치로 읽을 수 있음: 기존 열 순서(origin/main 389899a)는 그대로, 새 열은 맨 끝
const MAIN_SUB_HEAD = 'application_id,submitted_at,gender,birth_year,school,source,device,intent,intent_other,phone,consent,name,buddy,buddy_room,phone_digits,src,utm_source,utm_medium,utm_campaign,utm_content,utm_term,fbclid,city,cohort,channel,plan,device_auto,ref,sid'.split(',');
const MAIN_PART_HEAD = 'sid,status,first_at,last_at,page,last_field,gender,birth_year,school,source,device,intent,intent_other,phone,consent,name,buddy,buddy_room,src,channel,city,path,active_sec,device,in_app,ref'.split(',');
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  row.push(cell); rows.push(row); return rows;
}
test('export CSV keeps the old column order and appends major, avoid_same_major at the end', async () => {
  const reg = { gender: '남성', birth_year: '2002', school: '전남대학교', source: '인스타그램 광고', device: 'iPhone', intent: '설렘', intent_other: '', phone: '010-9999-8888', consent: '동의합니다', name: '김철수', buddy: '01022223333', buddy_room: '같은 방' };
  const regHidden = { src: 'ad1', utm_source: 'ig', utm_medium: 'paid', utm_campaign: 'c3', utm_content: 'ad1', utm_term: 't', fbclid: 'x', city: 'gwangju', cohort: '3', channel: 'ad1', plan: 'regular', device_auto: '1' };
  const kvRows = new Map([
    ['s:1-a', JSON.stringify({ application_id: 'a', submitted_at: '2026-09-30 10:00:00', ts: 1, fields: reg, phone_digits: '01099998888', hidden: regHidden, ref: 'r', sid: 'a' })],
    ['s:2-b', JSON.stringify({ application_id: 'b', submitted_at: '2026-09-30 11:00:00', ts: 2, fields: { ...fields, major: '=HYPERLINK("x")' }, phone_digits: '01012345678', hidden: { city: 'gwangju', plan: 'jnu_festival' }, ref: '', sid: 'b' })],
  ]);
  const kv = { get: async (k, t) => (t === 'json' ? JSON.parse(kvRows.get(k)) : kvRows.get(k)), list: async () => ({ keys: [...kvRows.keys()].map((name) => ({ name })), list_complete: true }) };
  const sessions = [
    { sid: 'a', submitted: 1, started: 1, first_ts: 1, last_ts: 2, max_page: 3, last_field: 'name', fields: JSON.stringify(reg), src: 'ad1', channel: 'ad1', city: 'gwangju', path: '/gwangju/', active_ms: 5000, device: 'iOS', in_app: '인스타', ref: 'r' },
    { sid: 'b', submitted: 0, started: 1, first_ts: 3, last_ts: 4, max_page: 2, last_field: 'major', fields: JSON.stringify({ major: '-경영학과', avoid_same_major: '상관없음' }), src: null, channel: 'direct', city: 'gwangju', path: '/jnu-festival/', active_ms: 1000, device: 'Android', in_app: '', ref: '' },
  ];
  const DB = { prepare: () => ({ all: async () => ({ results: sessions }) }) };
  const get = async (type) => (await onRequest({ request: new Request('http://localhost/api/export?token=read&type=' + type), params: { path: ['export'] }, env: { APPLY_KV: kv, DB, READ_TOKEN: 'read' } })).text();

  const sub = parseCsv(await get('submissions'));
  assert.deepEqual(sub[0].slice(0, MAIN_SUB_HEAD.length), MAIN_SUB_HEAD, '기존 열 위치 그대로');
  assert.deepEqual(sub[0].slice(MAIN_SUB_HEAD.length), ['major', 'avoid_same_major'], '새 열은 맨 끝');
  const col = (name) => MAIN_SUB_HEAD.indexOf(name);
  assert.equal(sub[1][col('buddy_room')], '같은 방');
  assert.equal(sub[1][col('phone_digits')], '01099998888');
  assert.equal(sub[1][col('plan')], 'regular');
  assert.equal(sub[1][col('sid')], 'a');
  assert.deepEqual(sub[1].slice(MAIN_SUB_HEAD.length), ['', '']);
  assert.equal(sub[2][col('plan')], 'jnu_festival');
  assert.deepEqual(sub[2].slice(MAIN_SUB_HEAD.length), ["'=HYPERLINK(\"x\")", '같은 과 피하기'], '학과가 수식으로 읽히지 않게');

  const part = parseCsv(await get('partials'));
  assert.deepEqual(part[0].slice(0, MAIN_PART_HEAD.length), MAIN_PART_HEAD);
  assert.deepEqual(part[0].slice(MAIN_PART_HEAD.length), ['major', 'avoid_same_major']);
  assert.equal(part[1][MAIN_PART_HEAD.indexOf('path')], '/gwangju/');
  assert.equal(part[1][MAIN_PART_HEAD.length - 1], 'r');
  assert.deepEqual(part[2].slice(MAIN_PART_HEAD.length), ["'-경영학과", '상관없음']);
});

test('festival submission still shows up in D1 when migration 0007 is missing on the remote DB', async () => {
  const schema = readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => n < '0007').sort()
    .map((n) => readFileSync(new URL('../migrations/' + n, import.meta.url), 'utf8')).join('\n');
  const run = async (withNew) => {
    const sql = new DatabaseSync(':memory:');
    sql.exec(schema);
    if (withNew) sql.exec(readFileSync(new URL('../migrations/0007_jnu_festival.sql', import.meta.url), 'utf8'));
    const stmt = (q, a) => ({ run: () => sql.prepare(q.replace(/\?(\d+)/g, '?$1')).run(...a) });
    const DB = { prepare: (q) => ({ bind: (...a) => stmt(q, a) }), async batch(st) { sql.exec('BEGIN'); try { for (const s of st) s.run(); sql.exec('COMMIT'); } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
    const res = await at(deadline - 1000, () => submit({ APPLY_KV: memKV(), DB }, festBody()));
    assert.equal(res.status, 200);
    return sql.prepare('SELECT * FROM submissions WHERE application_id = ?').get(SID);
  };
  const without = await run(false);
  assert.ok(without, '0007 이 없어도 신청자 행은 남아야 함');
  assert.equal(without.plan, 'jnu_festival');
  assert.equal(without.buddy_room, '같은 방');
  const withNew = await run(true);
  assert.equal(withNew.major, '소프트웨어공학과');
  assert.equal(withNew.avoid_same_major, '같은 과 피하기');
  assert.equal(withNew.student_card_key, 'img:' + SID);
});
