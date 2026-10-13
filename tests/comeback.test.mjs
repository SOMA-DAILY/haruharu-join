import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, formStatus, feeLabel, listedForms } from '../shared/forms.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const paths = ['/5/seoul/comeback/', '/5/gwangju/comeback/'];
const END = Date.parse('2026-10-14T00:00:00+09:00');   // 10/13(화) 자정
const read = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');
const fields = { gender: '여성', birth_year: '2003', school: '서울대학교', source: '그 외', device: 'iPhone', phone: '01012345678', consent: '동의합니다', name: '홍길동' };
const submit = async (path, now) => {
  const real = Date.now; Date.now = () => now;
  try {
    const writes = [];
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields, ua: 'iPhone' }) }), params: { path: ['submit'] }, env: { APPLY_KV: { put: async (k, v) => writes.push([k, v]) } }, waitUntil: () => {} });
    const rec = writes.find(([k]) => k.startsWith('s:'));
    return { res, record: rec ? JSON.parse(rec[1]) : null };
  } finally { Date.now = real; }
};

test('자정 마감 할인 폼은 4,900원이고 지역 선택에 안 나온다', () => {
  for (const path of paths) {
    const f = formOf(path);
    assert.equal(f.cohort, '5'); assert.equal(f.plan, 'discount'); assert.equal(f.fee, 4900); assert.equal(f.wasFee, 7900);
    assert.match(f.pay, /\/e\/$/); assert.equal(f.friendFee, undefined); assert.equal(f.rejoin, undefined);
    assert.equal(feeLabel(f), '할인 4,900원');
    assert.ok(!listedForms().some((x) => x.path === path));
  }
});

test('10/13 자정에 이 폼만 닫히고 5기 정가 폼은 그대로 열려 있다', () => {
  for (const path of paths) {
    const before = formStatus(path, END - 1), after = formStatus(path, END);
    assert.equal(before.open, true); assert.equal(before.deadline, END);
    assert.equal(after.open, false); assert.equal(after.next, path.replace('comeback/', ''));
    assert.equal(formStatus(path.replace('comeback/', ''), END).open, true);
    assert.equal(formStatus(path, END - 1, { FORM_DEADLINE: String(END - 5000) }).open, false);   // 로컬 시험용 환경값
  }
  assert.equal(formStatus('/5/seoul/', END, { FORM_DEADLINE: '1' }).open, true);   // 자체 마감이 없는 폼엔 안 먹음
});

test('서버는 자정 전 제출만 받고 그 뒤는 저장하지 않는다', async () => {
  const ok = await submit(paths[0], END - 1);
  assert.equal(ok.res.status, 200); assert.equal(ok.record.hidden.plan, 'discount'); assert.equal(ok.record.friend_fee || 0, 0);
  const late = await submit(paths[0], END);
  assert.equal(late.res.status, 409); assert.equal((await late.res.json()).error, 'cohort_closed'); assert.equal(late.record, null);
});

test('화면: 남은 시간 표시, 7,900 → 4,900, 한 페이지 구성, 친구 할인 없음', () => {
  for (const path of paths) {
    const html = read(path);
    assert.ok(html.includes('DEADLINE=' + END + ','));
    for (const need of ['id="cbBar"', 'id="cbClock"', '아직 고민 중이라면?', '<s>7,900원</s> <b>4,900원</b>', '<p class="fee-was"><s>7,900원</s> → <strong>4,900원</strong></p>', '▶ 토스로 4,900원 송금하기', 'haruharu-pay.pages.dev/e/', 'id="acctCopy"', '4,900원 할인이 끝났어요', 'href="' + path.replace('comeback/', '') + '?src=h5-'])
      assert.ok(html.includes(need), path + ' 에 없음: ' + need);
    for (const not of ['12,900', '5,900', 'class="fr-share"', 'class="fr-mini"', 'data-engage', 'id="ldSticky"']) assert.ok(!html.includes(not), path + ' 에 있으면 안 됨: ' + not);
    assert.equal((html.match(/<section class="page[^"]*" data-page="\d">/g) || []).length, 1);   // 페이지를 안 나눔
    assert.ok(!html.includes('data-next=') && !html.includes('data-prev='));
    const order = ['data-name="gender"', '<div class="q" data-name="phone">', '<div class="q" data-name="consent">', '<div class="q" data-name="name">', 'id="submit"'].map((k) => html.indexOf(k));
    assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), path + ' 문항 순서');
  }
});

test('관리 화면 메시지 링크 카드는 자정 마감으로 표시하고 코드가 따로 잡힌다', () => {
  const admin = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  assert.ok(admin.includes("f.deadlineKo?', '+f.deadlineKo+' 마감'"));
  assert.ok(admin.includes("(f.comeback?p.split('/').filter(Boolean).pop():f.plan+(f.variant?'-'+f.variant:''))"));
  assert.ok(admin.includes('"deadlineKo": "10월 13일(화) 자정"'));
});

test('낮 1시 마감 할인 폼: 주소만 다르고 10/14 13:00 에 닫힌다', async () => {
  const END2 = Date.parse('2026-10-14T13:00:00+09:00');
  for (const path of ['/5/seoul/lunch/', '/5/gwangju/lunch/']) {
    const f = formOf(path);
    assert.equal(f.fee, 4900); assert.equal(f.plan, 'discount'); assert.match(f.pay, /\/e\/$/);
    assert.equal(formStatus(path, END2 - 1).open, true); assert.equal(formStatus(path, END2).open, false);
    assert.equal(formStatus(path, END2).next, path.replace('lunch/', ''));
    const html = read(path);
    for (const gone of ['name="gender"', 'name="birth_year"', 'name="school"', 'name="source"', 'name="intent"']) assert.ok(!html.includes(gone), path + ' 에 남아 있음: ' + gone);
    for (const need of ['class="cb-resume"', 'name="phone"', 'name="consent"', 'name="name"', 'DEADLINE=' + END2 + ',', '오늘 낮 1시까지만<br>', '1시가 지나면 다시 7,900원이에요', '10월 14일(수) 낮 1시 마감', '▶ 토스로 4,900원 송금하기', 'id="cbClock"'])
      assert.ok(html.includes(need), path + ' 에 없음: ' + need);
    assert.ok(!html.includes('자정') && !html.includes('__CB_'));
  }
  assert.ok(read('/5/seoul/comeback/').includes('오늘 자정까지만<br>'));   // 앞 폼 글자는 그대로
  assert.equal((await submit('/5/seoul/lunch/', END2 - 1)).res.status, 200);
  assert.equal((await submit('/5/seoul/lunch/', END2)).res.status, 409);
});

test('마감 할인 폼은 같은 브라우저에 남은 5기 정가 폼 작성 내용도 이어 쓴다 (7일 이내)', () => {
  const html = read('/5/seoul/lunch/');
  assert.ok(html.includes("[DKEY,'hh_draft:/5/seoul/','hh_draft:/5/seoul/comeback/'].forEach("));
  assert.ok(html.includes('Date.now()-dr.t<7*864e5') && !html.includes('Date.now()-dr.t<6*3600e3'));
  assert.ok(read('/5/gwangju/lunch/').includes("'hh_draft:/5/gwangju/'") && !read('/5/gwangju/lunch/').includes("'hh_draft:/5/seoul/'"));
  assert.ok(read('/5/seoul/').includes('Date.now()-dr.t<6*3600e3'));   // 정가 폼은 그대로
});

test('빠른 신청: 전화번호, 동의, 이름만 받고 나머지는 같은 번호로 쓰다 만 기록에서 채운다', async () => {
  const sessions = [
    { sid: 'old', last_ts: 1, fields: JSON.stringify({ gender: '남성', birth_year: '2001', school: '옛학교', phone: '010-1234-5678' }) },
    { sid: 'new', last_ts: 2, fields: JSON.stringify({ gender: '여성', birth_year: '2003', school: '서울대학교', source: '인스타그램 광고', intent: '기타', phone: '01012345678', consent: '동의합니다' }) },
    { sid: 'other', last_ts: 3, fields: JSON.stringify({ gender: '남성', school: '남의학교', phone: '01099998888' }) },
  ];
  const DB = {
    prepare: (sql) => ({ bind: (...a) => ({
      all: async () => ({ results: /FROM sessions WHERE fields LIKE/.test(sql) ? sessions.filter((r) => a.some((pat) => r.fields.includes(pat.replace(/%/g, '')))).sort((x, y) => y.last_ts - x.last_ts) : [] }),
      first: async () => null, run: async () => ({}) }) }),
    batch: async () => [],
  };
  const real = Date.now; Date.now = () => Date.parse('2026-10-14T09:00:00+09:00');
  try {
    const post = async (fields) => {
      const writes = [];
      const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path: '/5/seoul/lunch/', fields, ua: 'Mozilla/5.0 (iPhone)' }) }), params: { path: ['submit'] }, env: { DB, APPLY_KV: { put: async (k, v) => writes.push([k, v]) } }, waitUntil: () => {} });
      const rec = writes.find(([k]) => k.startsWith('s:'));
      return { res, record: rec ? JSON.parse(rec[1]) : null };
    };
    const ok = await post({ phone: '01012345678', consent: '동의합니다', name: '홍길동', gender: '남성', school: '화면이 보낸 값' });
    assert.equal(ok.res.status, 200);
    const f = ok.record.fields;
    assert.equal(f.gender, '여성'); assert.equal(f.birth_year, '2003'); assert.equal(f.school, '서울대학교'); assert.equal(f.source, '인스타그램 광고'); assert.equal(f.device, 'iPhone'); assert.equal(f.consent, '동의합니다');
    assert.equal(ok.record.prior_from, 'session:new');
    const body = await ok.res.clone().text();
    assert.ok(!body.includes('서울대학교') && !body.includes('여성'));   // 응답에는 가져온 값이 안 나감
    const none = await post({ phone: '01077776666', consent: '동의합니다', name: '김철수' });
    assert.equal(none.res.status, 200); assert.equal(none.record.prior_from, ''); assert.equal(none.record.fields.gender, undefined);
    assert.equal((await post({ phone: '01012345678', name: '홍길동' })).res.status, 400);   // 동의는 필수
  } finally { Date.now = real; }
});

test('빌드된 마감 할인 폼의 스크립트는 문법 오류가 없다', () => {
  for (const path of ['/5/seoul/lunch/', '/5/gwangju/lunch/', '/5/seoul/comeback/', '/5/gwangju/comeback/']) {
    const scripts = [...read(path).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 3);
    for (const code of scripts) assert.doesNotThrow(() => new Function(code), path + ' 스크립트 문법');
  }
});
