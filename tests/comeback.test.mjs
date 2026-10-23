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
    assert.equal(after.open, false); assert.equal(after.next, (path.includes('/seoul/') ? '/8/seoul/' : '/'));   // 10/14: 6기가 열려서 다음은 6기 서울 (광주는 지역 선택). 10/17: 지금 기수 7기, 10/22: 8기
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
    for (const need of ['id="cbBar"', 'id="cbClock"', '아직 고민 중이라면?', '<s>7,900원</s> <b>4,900원</b>', '<p class="fee-was"><s>7,900원</s> → <strong>4,900원</strong></p>', '▶ 토스로 4,900원 송금하기', 'haruharu-pay.pages.dev/e/', 'id="acctCopy"', '<h2>신청이 마감됐어요</h2>', 'href="' + (path.includes('/seoul/') ? '/8/seoul/' : '/') + '?src=h8-'])   // 10/14: 5기가 닫혀서 할인 끝 안내 대신 기수 마감 + 다음 기수 버튼 (10/17: 7기)
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
    assert.equal(formStatus(path, END2).next, (path.includes('/seoul/') ? '/8/seoul/' : '/'));
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

test('저녁 6시 마감 할인 폼: 5기 마감과 같이 닫히고, 마감 뒤엔 기수 마감 안내', async () => {
  const END3 = Date.parse('2026-10-14T18:00:00+09:00');
  for (const path of ['/5/seoul/evening/', '/5/gwangju/evening/']) {
    const f = formOf(path);
    assert.equal(f.fee, 4900); assert.equal(f.plan, 'discount'); assert.equal(f.noSource, true);
    assert.equal(formStatus(path, END3 - 1).open, true); assert.equal(formStatus(path, END3).open, false);
    const html = read(path);
    for (const need of ['DEADLINE=' + END3 + ',', '오늘 저녁 6시까지만<br>', '저녁 6시에 5기 신청이 마감돼요', '10월 14일(수) 저녁 6시 마감', 'content="아직 고민 중이라면? 오늘 저녁 6시까지 4,900원"', '<h2>신청이 마감됐어요</h2>', '▶ 토스로 4,900원 송금하기'])
      assert.ok(html.includes(need), path + ' 에 없음: ' + need);
    assert.ok(html.includes('8기 신청하러 가기 →'), path + ' 8기 버튼');   // 10/14 6기, 10/17 지금 기수 7기, 10/22 8기
    for (const not of ['<h2>4,900원 할인이 끝났어요', '5기 신청하러 가기 →', '지나면 다시', 'name="source"', 'name="intent"', '__CB_']) assert.ok(!html.includes(not), path + ' 에 있으면 안 됨: ' + not);
  }
  assert.ok(read('/5/seoul/lunch/').includes('1시가 지나면 다시 7,900원이에요') && read('/5/seoul/lunch/').includes('<h2>신청이 마감됐어요</h2>'));   // 앞 판 글자는 그대로, 10/14 6기가 열려서 마감 뒤엔 기수 마감 안내
  assert.equal((await submit('/5/seoul/evening/', END3 - 1)).res.status, 200);
  assert.equal((await submit('/5/seoul/evening/', END3)).res.status, 409);
});

test('6기 낮 1시 할인은 5,900원 고정, 자체 마감은 13:00이며 지금 기수(8기) 전환 뒤에는 8기를 안내한다', async () => {
  const path = '/6/seoul/lunch/', end = Date.parse('2026-10-18T13:00:00+09:00');
  const f = formOf(path);
  assert.equal(f.cohort, '6'); assert.equal(f.fee, 5900); assert.equal(f.wasFee, 7900);
  assert.equal(f.pay, 'https://haruharu-pay.pages.dev/b/');
  assert.equal(f.friendFee, undefined); assert.equal(feeLabel(f), '할인 5,900원');
  assert.ok(!listedForms().some(x => x.path === path));
  assert.equal(formStatus(path, end - 1).open, true);
  assert.equal(formStatus(path, end).open, false);
  assert.equal(formStatus(path, Date.parse('2026-10-18T18:00:00+09:00')).next, '/8/seoul/');
  assert.equal(formStatus('/6/seoul/', end).open, true);
  const { source, ...noSource } = fields;
  const ok = await submit(path, end - 1, noSource);
  assert.equal(ok.res.status, 200); assert.equal(ok.record.hidden.cohort, '6');
  assert.equal(ok.record.hidden.plan, 'discount'); assert.equal(ok.record.friend_fee || 0, 0);
  const late = await submit(path, end, noSource);
  assert.equal(late.res.status, 409); assert.equal(late.record, null);
});

test('6기 낮 1시 화면은 기존 한 페이지 구성에 6기 일정과 5,900원 송금 및 마감 안내를 보여준다', () => {
  const html = read('/6/seoul/lunch/');
  for (const need of ['오늘 낮 1시까지만<br>', '<s>7,900원</s> <b>5,900원</b>',
    '10월 18일(일) 낮 1시 마감', '10월 19일(월) ~ 10월 21일(수)',
    '▶ 토스로 5,900원 송금하기', 'haruharu-pay.pages.dev/b/', 'id="acctCopy"', 'id="cbBar"', 'id="cbClock"',
    '<h2>신청이 마감됐어요</h2>', 'href="/8/seoul/?src=h8-seoul-student-from6"',
    '신청 진행과 마감 안내(작성 중인 신청 포함)']) assert.ok(html.includes(need), need);
  for (const gone of ['4,900', '12,900', 'name="source"', 'name="intent"', 'class="fr-share"', '__CB_', 'data-next=', 'data-prev='])
    assert.ok(!html.includes(gone), gone);
  assert.equal((html.match(/<section class="page[^"]*" data-page="\d">/g) || []).length, 1);
  assert.ok(read('/6/seoul/').includes('name="source"'));
});


test('7기 정오 할인은 정오 직전까지 5,900원으로 접수하고 정각부터 저장을 거부한다', async () => {
  const path = '/7/seoul/noon/', end = Date.parse('2026-10-22T12:00:00+09:00');
  assert.equal(formStatus(path, end - 1).open, true);
  assert.equal(formStatus(path, end - 1).deadline, end);
  assert.equal(formStatus(path, end).open, false);
  assert.equal(formStatus(path, end).next, '/8/seoul/');   // 지금 기수 8기 (nextFormPath). 7기 정가 폼 자체는 정오엔 아직 열려 있음
  assert.equal(formStatus('/7/seoul/', end).open, true);
  assert.equal(formStatus('/7/seoul/', Date.parse('2026-10-22T18:00:00+09:00')).open, false);
  const { source, ...noSource } = fields;
  const ok = await submit(path, end - 1, { ...noSource, buddy_room: '같은 방', buddy: '01000000001' });
  assert.equal(ok.res.status, 200);
  assert.equal(ok.record.hidden.cohort, '7');
  assert.equal(ok.record.hidden.plan, 'discount');
  assert.equal(ok.record.friend_fee || 0, 0);
  for (const now of [end, end + 1, end + 3600000]) {
    const late = await submit(path, now, noSource);
    assert.equal(late.res.status, 409);
    assert.equal(late.record, null);
  }
});

test('7기 할인 화면과 관리자 카드의 금액, 정오 마감, 진행 날짜 및 종료 안내가 일치한다', () => {
  const html = read('/7/seoul/noon/');
  for (const need of ['10월 22일 낮 12시까지만<br>', '<s>7,900원</s> <b>5,900원</b>',
    '10월 22일(목) 낮 12시 마감', '10월 23일(금) ~ 10월 25일(일)',
    '▶ 토스로 5,900원 송금하기', 'haruharu-pay.pages.dev/b/', 'id="cbBar"', 'id="cbClock"',
    '<h2>신청이 마감됐어요</h2>', '7기 신청은 10월 22일(목) 낮 12시에 마감됐어요.',
    'href="/8/seoul/?src=h8-seoul-student-from7"']) assert.ok(html.includes(need), need);   // 10/22 18:00 지금 기수 8기: 할인 끝 안내 대신 기수 마감 안내 + 8기 버튼 (6기 lunch 와 같은 규칙)
  for (const gone of ['name="source"', 'name="intent"', 'class="fr-share"', '__CB_', 'data-next=', 'data-prev='])
    assert.ok(!html.includes(gone), gone);
  assert.equal((html.match(/<section class="page[^"]*" data-page="\d">/g) || []).length, 1);
  assert.ok(!listedForms().some(x => x.path === '/7/seoul/noon/'));
  const admin = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  assert.ok(admin.includes('7기 서울 학생 정오 마감 할인'));
  assert.ok(admin.includes('10월 22일(목) 낮 12시'));
  assert.ok(admin.includes("m[3]==='noon'?' 정오 마감 할인':"));
});
