import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, feeLabel, formStatus, entryTarget, COHORT_DEADLINES } from '../shared/forms.mjs';
import { onRequestGet as entryGet } from '../functions/rejoin/seoul/men/index.js';
import { feeFor, friendFee } from '../shared/friend-discount.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const PATH = '/8/seoul/rejoin/men/';
const END = Date.parse(COHORT_DEADLINES['8']);
const FIELDS = { phone: '01000000001' };
async function submit(fields = {}, now = END - 1, path = PATH, priorRows = []) {
  const old = Date.now, writes = [];
  Date.now = () => now;
  try {
    const DB = { prepare: sql => ({ bind: () => ({ all: async () => ({ results: /FROM submissions WHERE phone_digits/.test(sql) ? priorRows : [] }), first: async () => null, run: async () => ({}) }) }), batch: async () => [] };
    const res = await onRequest({ request: new Request('http://localhost/api/submit', {
      method: 'POST', body: JSON.stringify({ path, fields: { ...FIELDS, ...fields },
        hidden: { src: 'h8-msg-seoul-rejoin-m', cohort: '9', city: 'wrong', plan: 'regular', fee: 1 },
        ua: 'iPhone local QA' }) }), params: { path: ['submit'] },
      env: { DB, APPLY_KV: { put: async (key, value) => writes.push([key, value]) } }, waitUntil() {} });
    const saved = writes.find(([k]) => k.startsWith('s:'));
    return { res, writes, rec: saved && JSON.parse(saved[1]) };
  } finally { Date.now = old; }
}

test('male rejoin route has fixed 8000 fee with phone and payment only', () => {
  const f = formOf(PATH);
  assert.equal(f.cohort, '8'); assert.equal(f.fixedGender, '남성');
  assert.equal(feeLabel(f), '재참여 8,000원');
  assert.deepEqual(feeFor(f, '남성'), { fee: 8000, pay: 'https://haruharu-pay.pages.dev/mr/', friendFee: undefined, friendPay: undefined });
  assert.equal(friendFee(f, { ...FIELDS, buddy_room: '같은 방', buddy: '01000000002' }), 0);
  assert.equal(f.phoneOnly, true); assert.equal(f.phonePaymentOnly, true);
  assert.equal(f.pick,true);
  for (const k of ['survey', 'joins', 'listed', 'friendFee']) assert.equal(f[k], undefined, k);
  assert.equal(f.deadline, undefined); assert.equal(f.comeback, undefined);
  assert.equal(formOf('/rejoin/seoul/returning-men/').reviewCohort, '7');
  assert.equal(formOf('/rejoin/seoul/returning/').fee, 5900);
});

test('no review or previous submission is needed; server stores cohort8 discount and campaign source', async () => {
  const { res, rec } = await submit({ sv_join: '9기' });
  assert.equal(res.status, 200);
  assert.equal(rec.hidden.cohort, '8'); assert.equal(rec.hidden.plan, 'discount');
  assert.equal(rec.hidden.city, 'seoul'); assert.equal(rec.hidden.src, 'h8-msg-seoul-rejoin-m');
  assert.equal(rec.fields.gender, '남성'); assert.equal(rec.fields.birth_year, undefined);
  assert.equal(rec.fields.school, undefined); assert.equal(rec.fields.phone, FIELDS.phone);
  assert.equal(rec.survey, undefined); assert.equal(rec.prior_from, '');
  assert.equal(rec.friend_fee, undefined);
});

test('cohort choice uses the matching discounted route, preserves source and accepts 9 after 8 closes', async () => {
  for(const [page,choice,cohort,time] of [[PATH,'9','9',END-1],['/9/seoul/rejoin/men/','8','8',END-1],[PATH,'9','9',END+1]]){
    const {res,rec}=await submit({cohort_pick:choice},time,page);
    assert.equal(res.status,200);assert.equal(rec.hidden.cohort,cohort);
    assert.equal(rec.hidden.plan,'discount');assert.equal(rec.from_page,page);
    assert.equal(formOf(`/${cohort}/seoul/rejoin/men/`).fee,8000);
  }
  const bad=await submit({cohort_pick:'7'});assert.equal(bad.res.status,400);assert.equal(bad.writes.length,0);
});

test('unrequested friend fields never add a discount; actual previous gender is verified', async () => {
  const friend = await submit({ buddy_room: '같은 방', buddy: '01000000002' });
  assert.equal(friend.res.status, 200); assert.equal(friend.rec.friend_fee, undefined);
  assert.equal(friend.rec.fields.buddy, undefined);
  const bad = await submit({}, END - 1, PATH, [{application_id:'prior-f',gender:'여성',name:'이전 신청'}]);
  assert.equal(bad.res.status, 400); assert.equal((await bad.res.json()).error, 'gender_not_allowed');
  assert.equal(bad.writes.length, 0);
});

test('only a valid phone is required; previous profile and remitter name are restored server-side', async () => {
  for (const phone of ['', 'abc', '010123', '8.21012345678E+11']) {
    const result = await submit({ phone });
    assert.equal(result.res.status, 400, phone);
    assert.ok((await result.res.json()).miss.includes('phone'));
    assert.equal(result.writes.length, 0);
  }
  const previous=[{application_id:'previous',name:'지난 송금자',gender:'남성',birth_year:'2003',school:'이전 대학',device:'Android'}];
  const result=await submit({name:'untrusted',birth_year:'2099',school:'untrusted'},END-1,PATH,previous);
  assert.equal(result.res.status,200);
  assert.equal(result.rec.fields.name,'지난 송금자');
  assert.equal(result.rec.fields.birth_year,'2003');assert.equal(result.rec.fields.school,'이전 대학');
  assert.equal(result.rec.fields.device,'iPhone');assert.equal(result.rec.prior_from,'previous');
});

test('deadline is enforced at 10/29 18:00 on both status and submission', async () => {
  assert.equal(formStatus(PATH, END - 1, undefined, 'm').open, true);
  assert.equal(formStatus(PATH, END, undefined, 'm').open, false);
  const closed = await submit({}, END);
  assert.equal(closed.res.status, 409); assert.equal(closed.writes.length, 0);
});

test('permanent discount link moves from cohort8 to9 without an expiring discount or losing source', async () => {
  assert.equal(entryTarget('/rejoin/seoul/men/', END - 1, undefined, 'm'), PATH);
  assert.equal(entryTarget('/rejoin/seoul/men/', END, undefined, 'm'), '/9/seoul/rejoin/men/');
  const old = Date.now; Date.now = () => END;
  try {
    const response = await entryGet({ request: new Request('https://join.haruharu.co.kr/rejoin/seoul/men/?g=m&src=msg-seoul-rejoin-m&utm_campaign=returning'), env: {} });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/9/seoul/rejoin/men/?g=m&src=msg-seoul-rejoin-m&utm_campaign=returning');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { Date.now = old; }
  const next = await submit({}, END + 1, '/9/seoul/rejoin/men/');
  assert.equal(next.res.status, 200); assert.equal(next.rec.hidden.cohort, '9');
  assert.equal(formOf('/9/seoul/rejoin/men/').fee, 8000);
});

test('built page contains phone and payment only without the removed sentence or other questions', () => {
  const html = readFileSync(new URL('../public' + PATH + 'index.html', import.meta.url), 'utf8');
  assert.match(html, /10월 30일\(금\) ~ 11월 1일\(일\)/);
  assert.match(html, /재참여 할인가로/);
  assert.doesNotMatch(html, /오늘 오후 6시까지만|id="cbBar"|id="cbClock"|할인이 끝났어요/);
  assert.match(html, /<input type="tel" name="phone"/);
  for(const key of ['gender','birth_year','school','device','name','buddy','buddy_room','consent'])
    assert.doesNotMatch(html,new RegExp('<input[^>]*name="'+key+'"'));
  assert.match(html,/id="pick"[^>]*data-gender="m"/);
  assert.match(html,/name="cohort_pick"/);
  assert.match(html,/data-path="\/8\/seoul\/rejoin\/men\/"/);
  assert.match(html,/data-path="\/9\/seoul\/rejoin\/men\/"/);
  assert.doesNotMatch(html, /후기 작성 없이|송금 후 송금자 이름을 적어|name="sv_|후기를 남겨|7기 참가자 전용|친구도.*8,000원/);
  assert.match(html,/송금 후 신청 완료/);
  assert.match(html, /<s>10,000원<\/s> <b>8,000원<\/b>/);
  assert.match(html, /id="pay" href="https:\/\/haruharu-pay\.pages\.dev\/mr\/"/);
  assert.equal((html.match(/data-page="1"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-page="2"|class="fr-share"|class="fr-fee"/);
  assert.match(html, /id="acctCopy"/);
});
