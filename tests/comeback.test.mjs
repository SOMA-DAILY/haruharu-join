import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, formStatus, feeLabel, listedForms } from '../shared/forms.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const paths = ['/5/seoul/comeback/', '/5/gwangju/comeback/'];
const END = Date.parse('2026-10-14T00:00:00+09:00');   // 10/13(화) 자정
const read = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');
const fields = { gender: '여성', birth_year: '2003', school: '서울대학교', source: '그 외', device: 'iPhone', phone: '01012345678', consent: '동의합니다', name: '홍길동' };
const submit = async (path, now, flds = fields) => {
  const real = Date.now; Date.now = () => now;
  try {
    const writes = [];
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields: flds, ua: 'iPhone' }) }), params: { path: ['submit'] }, env: { APPLY_KV: { put: async (k, v) => writes.push([k, v]) } }, waitUntil: () => {} });
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
    for (const need of ['DEADLINE=' + END2 + ',', '오늘 낮 1시까지만<br>', '1시가 지나면 다시 7,900원이에요', '10월 14일(수) 낮 1시 마감', '▶ 토스로 4,900원 송금하기', 'id="cbClock"'])
      assert.ok(html.includes(need), path + ' 에 없음: ' + need);
    assert.ok(!html.includes('자정') && !html.includes('__CB_'));
  }
  assert.ok(read('/5/seoul/comeback/').includes('오늘 자정까지만<br>'));   // 앞 폼 글자는 그대로
  assert.equal((await submit('/5/seoul/lunch/', END2 - 1)).res.status, 200);
  assert.equal((await submit('/5/seoul/lunch/', END2)).res.status, 409);
});

test('낮 1시 마감 폼은 유입 경로와 신청 마음 문항이 없고 서버도 요구하지 않는다', async () => {
  for (const path of ['/5/seoul/lunch/', '/5/gwangju/lunch/']) {
    const html = read(path);
    for (const gone of ['name="source"', 'name="intent"', 'name="intent_other"', '어디서 보고 오셨나요', '어떤 마음으로 신청하시나요']) assert.ok(!html.includes(gone), path + ' 에 남아 있음: ' + gone);
    for (const need of ['name="gender"', 'name="birth_year"', 'name="school"', 'name="phone"', 'name="consent"', 'name="name"']) assert.ok(html.includes(need), path + ' 에 없음: ' + need);
  }
  assert.ok(read('/5/seoul/').includes('name="source"') && read('/5/seoul/comeback/').includes('name="source"'));   // 다른 폼은 그대로
  const END2 = Date.parse('2026-10-14T13:00:00+09:00');
  const { source, ...noSource } = fields;
  assert.equal((await submit('/5/seoul/lunch/', END2 - 1, noSource)).res.status, 200);
  assert.equal((await submit('/5/seoul/comeback/', END - 1, noSource)).res.status, 400);   // 다른 폼은 여전히 필수
});
