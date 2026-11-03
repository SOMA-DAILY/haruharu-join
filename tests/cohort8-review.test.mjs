import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { formOf, COHORT_DEADLINES, COHORT_INFO, FORMS } from '../shared/forms.mjs';
import { reviewRows } from '../shared/review-cohorts.mjs';
import { feeFor, friendFee } from '../shared/friend-discount.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const variants = [
  { page: '/rejoin/8/seoul/', target: '/9/seoul/rejoin/from-8/', gender: '여성', g: 'f', fee: 5900, pay: '/b/' },
  { page: '/rejoin/8/seoul/men/', target: '/9/seoul/rejoin/from-8-men/', gender: '남성', g: 'm', fee: 8000, pay: '/mr/' },
];
const deadline = Date.parse(COHORT_DEADLINES['9']);
const review = '로컬 검증: 서로의 일상을 나누며 대화할 수 있어서 좋았습니다.';
async function submit(v, fields, { at = deadline - 1, path = v.page, priorGender = v.gender, database = null } = {}) {
  const old = Date.now, writes = [], runs = [];
  Date.now = () => at;
  const DB = database || { prepare: sql => ({ bind: (...args) => ({ sql, args,
    all: async () => ({ results: sql.startsWith('SELECT application_id, gender') && priorGender ? [{ application_id: 'previous-local', gender: priorGender, birth_year: '2003', school: '로컬 검증 대학교' }] : [] }),
    first: async () => ({ male: 0, female: 0, unknown: 0 }),
    run: async () => { runs.push({ sql, args }); return {}; } }) }),
    batch: async statements => { runs.push(...statements); return []; } };
  try {
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path,
      fields: { sv_review: review, sv_cohorts: ['7'], ...fields }, hidden: { g: v.g, src: 'rejoin-8-msg', cohort: '7', fee: 1 },
      sid: '00000000-0000-4000-8000-000000000008', ua: 'Local QA' }) }), params: { path: ['submit'] },
      env: { DB, APPLY_KV: { put: async (k, value) => writes.push([k, value]) } }, waitUntil() {} });
    const saved = writes.find(([k]) => k.startsWith('s:'));
    const inserted = runs.find(r => /INSERT INTO submissions/.test(r.sql));
    return { res, rec: saved && JSON.parse(saved[1]), storedPath: inserted?.args[2], runs };
  } finally { Date.now = old; }
}

function closedCapacityDatabase() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sql.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  sql.exec("INSERT INTO cohort_capacities(cohort,track,paths,male_limit,female_limit,updated_at) VALUES('9','seoul-student','[]',0,0,0)");
  const DB = { prepare(query) {
    let args = [];
    function run(method) {
      const statement = sql.prepare(query.replace(/\?(\d+)/g, (_, n) => '$p' + n));
      return args.length ? statement[method](Object.fromEntries(args.map((v, i) => ['p' + (i + 1), v]))) : statement[method]();
    }
    return { bind(...values) { args = values; return this; }, async first() { return run('get') || null; }, async all() { return { results: run('all') }; }, async run() { return { meta: run('run') }; } };
  }, async batch(statements) {
    sql.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result; }
    catch (e) { sql.exec('ROLLBACK'); throw e; }
  } };
  return { sql, DB };
}

for (const v of variants) {
  test(`${v.gender}: 익명 후기는 8기 출처로 저장하고 연락처·친구 정보 제거`, async () => {
    const { res, rec } = await submit(v, { sv_join: '후기만', phone: '01000000001', name: '가상 검증', buddy: '01000000002', buddy_room: '같은 방' }, { at: deadline + 1 });
    assert.equal(res.status, 200);
    assert.equal(rec.hidden.cohort, 'review'); assert.equal(rec.hidden.plan, 'review');
    assert.equal(rec.phone_digits, ''); assert.equal(rec.from_page, v.page);
    assert.deepEqual(rec.survey, { sv_review: review, sv_cohorts: ['8'] });
    for (const key of ['phone', 'name', 'buddy', 'buddy_room']) assert.equal(rec.fields[key], undefined);
    assert.equal(rec.fields.gender, v.gender);
  });
  test(`${v.gender}: 9기 재신청·출처·고정 요금과 친구 요청을 구분해 저장`, async () => {
    for (const path of [v.page, v.target]) {
      const { res, rec, storedPath } = await submit(v, { sv_join: '9기', phone: '01000000001', name: '로컬 검증', buddy_room: '같은 방', buddy: '01000000002' }, { path });
      assert.equal(res.status, 200); assert.equal(storedPath, v.target);
      assert.equal(rec.hidden.cohort, '9'); assert.equal(rec.hidden.plan, 'discount');
      assert.equal(rec.fields.gender, v.gender); assert.equal(rec.fields.buddy_room, '같은 방');
      assert.deepEqual(rec.survey.sv_cohorts, ['8']); assert.equal(rec.friend_fee, undefined);
      const f = formOf(storedPath); assert.equal(f.fee, v.fee);
      assert.equal(feeFor(f, v.gender).pay, 'https://haruharu-pay.pages.dev' + v.pay);
      assert.equal(friendFee(f, rec.fields), 0);
      const result = reviewRows([{ application_id: rec.id, path: storedPath, survey: rec.survey, submitted_ts: deadline - 1 }], { FORMS, DEADLINES: COHORT_DEADLINES, INFO: COHORT_INFO });
      assert.equal(result[0].participant, '8기 참가자');
    }
  });
  test(`${v.gender}: 필수 후기·재신청 연락처·송금자명·성별·마감 검증`, async () => {
    for (const sv_join of ['8기', '10기', '']) assert.equal((await submit(v, { sv_join })).res.status, 400);
    for (const sv_review of ['', '짧음']) assert.equal((await submit(v, { sv_join: '후기만', sv_review })).res.status, 400);
    for (const missing of ['phone', 'name']) {
      const fields = { sv_join: '9기', phone: '01000000001', name: '로컬 검증' }; delete fields[missing];
      assert.equal((await submit(v, fields)).res.status, 400);
    }
    const fields = { sv_join: '9기', phone: '01000000001', name: '로컬 검증' };
    const closed = await submit(v, fields, { at: deadline });
    assert.equal(closed.res.status, 409); assert.equal(closed.rec, undefined); assert.equal(closed.runs.length, 0);
    const wrongGender = await submit(v, fields, { priorGender: v.gender === '여성' ? '남성' : '여성' });
    assert.equal(wrongGender.res.status, 400); assert.equal(wrongGender.rec, undefined);
  });
  test(`${v.gender}: 기존 화면에 8기 후기·9기 일정·해당 금액만 표시`, () => {
    const html = readFileSync(new URL('../public' + v.page + 'index.html', import.meta.url), 'utf8');
    assert.match(html, /8기, 어땠어요\?/); assert.match(html, /8기 참가자 전용/);
    assert.match(html, /name="sv_join" value="후기만" checked/);
    assert.match(html, /name="sv_join" value="9기"/); assert.doesNotMatch(html, /name="sv_join" value="8기"/);
    assert.match(html, /11\/6\(금\) ~ 11\/8\(일\)/);
    assert.ok(html.includes(v.fee.toLocaleString('en-US') + '원'));
    assert.ok(html.includes('href="https://haruharu-pay.pages.dev' + v.pay + '"'));
    assert.match(html, /name="sv_wish"[^>]*data-min="1"/);
  });
  test(`${v.gender}: 관리자가 정원을 닫으면 재신청을 막되 익명 후기는 계속 접수`, async () => {
    const { sql, DB } = closedCapacityDatabase();
    try {
      const full = await submit(v, { sv_join: '9기', phone: '01000000001', name: '로컬 검증' }, { database: DB });
      assert.equal(full.res.status, 409); assert.equal((await full.res.json()).error, 'cohort_full');
      assert.equal(full.rec, undefined); assert.equal(sql.prepare('SELECT COUNT(*) n FROM submissions').get().n, 0);
      assert.equal((await submit(v, { sv_join: '후기만' }, { database: DB })).res.status, 200);
    } finally { sql.close(); }
  });
}
