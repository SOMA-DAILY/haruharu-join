import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, formStatus, feeLabel, listedForms, FORMS, COHORT_INFO } from '../shared/forms.mjs';
import { SURVEY, SURVEY_KEYS, cleanSurvey } from '../shared/rejoin-survey.mjs';
import { onRequest } from '../functions/api/[[path]].js';
Date.now = () => Date.parse('2026-10-18T10:00:00+09:00');   // 6기 마감 전

const PAGE = '/rejoin/seoul/', J6 = '/6/seoul/rejoin/', J7 = '/7/seoul/rejoin/';
const read = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');
const sec = (html, n) => {
  const m = html.match(new RegExp('<section class="page[^"]*" data-page="' + n + '">([\\s\\S]*?)(?=<section class="page|</form>)'));
  assert.ok(m, '폼 페이지 ' + n);
  return m[1];
};
const db = (rows, runs = []) => ({
  prepare: (sql) => ({ bind: (...a) => ({ sql, a, all: async () => ({ results: /FROM submissions WHERE phone_digits/.test(sql) ? rows.filter((r) => r.phone_digits === a[0]) : [] }), first: async () => null, run: async () => { runs.push([sql, a]); return {}; } }) }),
  batch: async (stmts) => { for (const x of stmts) runs.push([x.sql, x.a]); return []; },
});
const submit = async (path, fields, env = {}, at) => {
  const writes = [], o = Date.now; if (at) Date.now = () => Date.parse(at);
  try {
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields, sid: '00000000-0000-4000-8000-000000000001' }) }), params: { path: ['submit'] }, env: { APPLY_KV: { put: async (k, v) => writes.push([k, v]) }, ...env }, waitUntil: () => {} });
    const rec = writes.find(([k]) => k.startsWith('s:'));
    return { res, record: rec ? JSON.parse(rec[1]) : null };
  } finally { Date.now = o; }
};
const full = () => ({ sv_review: '미션 덕분에 말 걸기가 편했어요.\n둘째 날부터는 조용했어요.', sv_wish: '비슷한 나이대끼리 모였으면 좋겠어요.', sv_review_ok: '1', sv_wish_ok: '1' });

test('재참여 후기 폼: 한 장(/rejoin/seoul/)에서 6기/7기/후기만, 기수 줄은 후기 할인 5,900원 + 친구랑 3,900원(/k/)', () => {
  const page = formOf(PAGE);
  assert.equal(page.cohort, 'review'); assert.ok(page.survey && page.phoneOnly && page.noDeadline);
  assert.deepEqual(page.joins, { '6기': J6, '7기': J7, '후기만': PAGE });
  assert.deepEqual(page.joinFor, { '6기': 'f', '7기': 'm' });   // 6기는 여성, 7기는 남성 (10/18 운영자)
  for (const [p, c] of [[J6, '6'], [J7, '7']]) {
    const f = formOf(p);
    assert.equal(f.cohort, c); assert.equal(f.plan, 'discount'); assert.equal(f.fee, 5900); assert.equal(f.wasFee, 7900);
    assert.equal(f.friendFee, 3900); assert.match(f.friendPay, /\/k\/$/); assert.match(f.pay, /\/b\/$/);
    assert.ok(f.noPage && f.survey && f.rejoin); assert.equal(feeLabel(f), '재참여 5,900원');
  }
  assert.equal(COHORT_INFO['7'].period, '10월 23일(금) ~ 10월 25일(일), 3일');
  for (const key of ['period', 'deadline', 'deadlineKo']) assert.equal(formOf(J7)[key], undefined, key + '는 기수 공통 설정을 따름');
  assert.ok(![PAGE, J6, J7].some((p) => listedForms().some((x) => x.path === p)));
  // 친구는 고정 링크가 가리키는 정가 폼에서 친구 할인 5,900원
  assert.ok(Object.values(FORMS).filter((f) => f.entry === page.friendForm).every((f) => f.friendFee === 5900));
  // 6기 마감(오늘 18:00) 뒤에도 페이지와 7기는 열려 있음
  const after = Date.parse('2026-10-18T18:30:00+09:00');
  assert.equal(formStatus(J6, after).open, false); assert.equal(formStatus(J7, after).open, true); assert.equal(formStatus(PAGE, after).open, true);
  assert.equal(formStatus(J7, Date.parse('2026-10-21T17:59:59.999+09:00')).open, true);
  assert.equal(formStatus(J7, Date.parse('2026-10-21T18:00:00+09:00')).open, false);
});

test('주관식 두 문항: 둘 다 필수, 짧으면 빠진 것으로, 길면 자름', () => {
  assert.deepEqual(SURVEY_KEYS, ['sv_review', 'sv_wish']);
  const ok = cleanSurvey(full());
  assert.deepEqual(ok.miss, []); assert.equal('sv_review_ok' in ok.survey, false);
  assert.deepEqual(cleanSurvey({}).miss, ['sv_review', 'sv_wish']);
  const short = cleanSurvey({ sv_review: '  좋았어요  ', sv_wish: 'x'.repeat(5000) });
  assert.deepEqual(short.miss, ['sv_review']);   // min 10자
  assert.equal(short.survey.sv_wish.length, SURVEY.sv_wish.max);
});

test('서버: 고른 값으로 기수 줄에 접수하고, 방문 기록은 페이지 경로로', async () => {
  const runs = [];
  const rows = [{ application_id: 'old', phone_digits: '01011112222', gender: '여성', birth_year: '2003', school: '테스트대', device: 'iPhone' }];
  const six = await submit(PAGE, { ...full(), sv_join: '6기', phone: '01011112222', name: '지난참가', buddy_room: '같은 방', buddy: '01033334444' }, { DB: db(rows, runs) });
  assert.equal(six.res.status, 200);
  assert.equal(six.record.hidden.cohort, '6'); assert.equal(six.record.hidden.plan, 'discount'); assert.equal(six.record.friend_fee, 3900);
  assert.equal(six.record.from_page, PAGE); assert.equal(six.record.fields.gender, '여성');
  assert.equal(six.record.survey.sv_wish, '비슷한 나이대끼리 모였으면 좋겠어요.');
  const ins = runs.find(([sql]) => /INSERT OR REPLACE INTO submissions/.test(sql)), sess = runs.filter(([sql]) => /sessions/.test(sql));
  assert.equal(ins[1][2], J6);   // 신청 사본은 고른 기수 줄
  assert.ok(sess.length === 2 && sess.every(([, a]) => a[1] === PAGE));   // 방문 기록은 페이지
  const seven = await submit(PAGE, { ...full(), sv_join: '7기', phone: '01011112222', name: '지난참가', buddy_room: '혼자' });
  assert.equal(seven.record.hidden.cohort, '7'); assert.equal(seven.record.friend_fee, 0);
  // 고르지 않았거나 모르는 값, 후기가 빠지면 거부
  for (const [fields, miss] of [[{ ...full(), phone: '01011112222', name: 'a' }, ['sv_join']], [{ ...full(), sv_join: '8기', phone: '01011112222', name: 'a' }, ['sv_join']], [{ sv_join: '6기', phone: '01011112222', name: 'a' }, ['sv_review', 'sv_wish']]]) {
    const bad = await submit(PAGE, fields);
    assert.equal(bad.res.status, 400); assert.deepEqual((await bad.res.json()).miss, miss);
  }
  const noName = await submit(PAGE, { ...full(), sv_join: '6기', phone: '01011112222' });
  assert.deepEqual((await noName.res.json()).miss, ['name']);
  // 6기 마감 뒤 6기를 고르면 409, 7기는 받음
  const late6 = await submit(PAGE, { ...full(), sv_join: '6기', phone: '01011112222', name: 'a' }, {}, '2026-10-18T18:00:01+09:00');
  assert.equal(late6.res.status, 409); assert.equal((await late6.res.json()).error, 'cohort_closed');
  const late7 = await submit(PAGE, { ...full(), sv_join: '7기', phone: '01011112222', name: 'a' }, {}, '2026-10-18T18:00:01+09:00');
  assert.equal(late7.res.status, 200);
  const before7 = await submit(PAGE, { ...full(), sv_join: '7기', phone: '01011112222', name: 'a' }, {}, '2026-10-21T17:59:59.999+09:00');
  assert.equal(before7.res.status, 200);
  const closed7 = await submit(PAGE, { ...full(), sv_join: '7기', phone: '01011112222', name: 'a' }, {}, '2026-10-21T18:00:00+09:00');
  assert.equal(closed7.res.status, 409); assert.equal((await closed7.res.json()).error, 'cohort_closed');
});

test('후기만: 전화번호, 이름, 참가비 없이 받는 익명 후기 (cohort review / plan review)', async () => {
  const r = await submit(PAGE, { ...full(), sv_join: '후기만', phone: '01011112222', buddy_room: '같은 방', buddy: '01033334444', name: '안씀' }, {}, '2026-10-30T12:00:00+09:00');
  assert.equal(r.res.status, 200);
  assert.equal(r.record.hidden.cohort, 'review'); assert.equal(r.record.hidden.plan, 'review');
  assert.equal('friend_fee' in r.record, false);
  for (const k of ['phone', 'name', 'buddy', 'buddy_room']) assert.equal(k in r.record.fields, false, k);   // 10/18 운영자: 전화번호는 신청하는 사람만
  assert.equal(r.record.phone_digits, ''); assert.equal('prior_from' in r.record, false);
  assert.equal(r.record.survey.sv_review.startsWith('미션'), true);
  const anon = await submit(PAGE, { ...full(), sv_join: '후기만' });
  assert.equal(anon.res.status, 200);
  const bad = await submit(PAGE, { sv_join: '후기만', sv_review: '짧음' });
  assert.deepEqual((await bad.res.json()).miss, ['sv_review', 'sv_wish']);
});

test('화면: 소개 없이 한 페이지에 후기, 바라는 점, 다음 기수([네] 하나, 기본 후기만), (네면) 전화번호/친구/참가비, 제출', () => {
  const html = read(PAGE), p1 = sec(html, 1);
  for (const w of ['data-page="2"', 'data-next=', 'data-prev=', '<div class="ld">', 'class="ld-hero', '소개팅 소개 다시 보기', '<input type="checkbox" name="consent"', 'dating_experience']) assert.equal(html.includes(w), false, w);
  assert.ok(html.includes('<html lang="ko" data-mode="form">') && html.includes('<title>하루하루 지난 기수 후기 💌</title>'));
  const at = (x) => { const i = p1.indexOf(x); assert.ok(i >= 0, x); return i; };
  assert.ok(at('<h1 class="sv-h1">지난 기수, 어땠어요?</h1>') < at('<div class="q sv-q" data-name="sv_review">'));
  assert.ok(at('<div class="q sv-q" data-name="sv_review">') < at('<div class="q sv-q" data-name="sv_wish">') && at('<div class="q sv-q" data-name="sv_wish">') < at('<div class="q sv-q" data-name="sv_join">')
    && at('<div class="q sv-q" data-name="sv_join">') < at('<div class="q" data-name="phone">') && at('<div class="q" data-name="phone">') < at('data-name="buddy_room"')
    && at('data-name="buddy_room"') < at('<div class="q" data-name="name">') && at('<div class="q" data-name="name">') < at('id="submit"'));
  // 다음 기수: 날짜 + [재참여하면 2,000원 할인돼요] + 보이는 칸은 [네, 신청할래요] 하나. 후기만은 숨긴 칸으로 처음부터 골라져 있음
  const jq = p1.slice(at('<div class="q sv-q" data-name="sv_join">'), at('<div class="q" data-name="phone">'));
  assert.deepEqual([...jq.matchAll(/name="sv_join" value="([^"]+)"/g)].map((m) => m[1]), ['6기', '7기', '후기만']);
  assert.ok(jq.includes('<label class="opt" hidden><input type="radio" name="sv_join" value="후기만" checked></label>') && !jq.includes('아니요') && jq.includes('네, <span class="sv-c">6기 </span>신청할래요'));
  assert.ok(jq.includes('재참여하면 <b>2,000원 할인</b>돼요<small><s>7,900원</s> → 5,900원</small>'));
  assert.ok(jq.includes('data-path="/6/seoul/rejoin/" data-g="f" data-reg="/6/seoul/"') && jq.includes('data-path="/7/seoul/rejoin/" data-g="m" data-reg=""'));
  assert.ok(jq.includes('<b>6기</b>10/19(월) ~ 10/21(수) 진행<small>신청 마감 10/18(일) 18:00</small>') && jq.includes('<b>7기</b>10/23(금) ~ 10/25(일) 진행<small>신청 마감 10/21(수) 18:00</small>'));
  for (const k of SURVEY_KEYS) assert.ok(p1.includes(`<textarea name="${k}"`) && p1.includes(`<input type="text" name="${k}_ok" value="" hidden required>`), k);
  const fq = p1.slice(at('<div class="q" data-name="buddy_room">'), at('<div class="q" data-name="name">'));
  assert.ok(/혼자 신청해요<\/span><b class="fr-p">5,900원/.test(fq) && /친구랑 같이 신청해요<small>친구는 5,900원<\/small><\/span><b class="fr-p">3,900원/.test(fq));
  assert.deepEqual([...fq.matchAll(/name="buddy_room" value="([^"]+)"/g)].map((m) => m[1]), ['혼자', '같은 방', '다른 방', '상관없음']);
  assert.ok(p1.includes('<b>재참여 할인</b><s>7,900원</s> → <strong>5,900원</strong>') && p1.includes('재참여 할인 + 친구 할인 적용') && p1.includes('id="acctCopy"'));
  assert.ok(html.includes("PAY='https://haruharu-pay.pages.dev/b/', FPAY='https://haruharu-pay.pages.dev/k/', SHARE_ONLY=false"));
  assert.ok(html.includes("location.origin+(window.HH_SHARE_PATH||'/seoul/student/')+'?'+g+'src=rejoin-friend'"));
  assert.ok(html.includes("if(window.hhSvClosed){ hhSvClosed(); throw new Error('sv_closed'); }") && html.includes("if(!window.HH_SV_REVIEW) fb('Lead'"));
  for (const c of '·「」①②③') assert.equal(html.replace('받은 질문 · 1', '').includes(c), false, c);
});

test('관리 화면: 설문 문항 글자, 모아 보기, 후기만 탭과 후기 폼 링크 카드', () => {
  const adm = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  assert.ok(adm.includes('"SURVEY":') && adm.includes('id="svBtn"') && adm.includes('function svSummary('));
  assert.ok(adm.includes("c==='review'?'재참여 후기만'") && adm.includes("if(f.joins)return") && adm.includes("s==='rejoin-msg'"));
});
