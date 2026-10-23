import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, feeLabel, listedForms } from '../shared/forms.mjs';
import { onRequest } from '../functions/api/[[path]].js';
Date.now = () => Date.parse('2026-10-12T12:00:00+09:00');   // 5기 모집 중

const phoneOnly = ['/5/seoul/rejoin/', '/5/gwangju/rejoin/'];
const invite = ['/5/seoul/rejoin/friend/', '/5/gwangju/rejoin/friend/'];
const read = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');
const sec = (html, n) => {
  const m = html.match(new RegExp('<section class="page[^\"]*" data-page="' + n + '">([\\s\\S]*?)(?=<section class="page|</form>)'));
  assert.ok(m, '폼 페이지 ' + n);
  return m[1];
};
// 같은 번호의 지난 신청을 돌려주는 가짜 D1
const db = (rows) => ({
  prepare: (sql) => ({ bind: (...a) => ({ all: async () => ({ results: /FROM submissions WHERE phone_digits/.test(sql) ? rows.filter((r) => r.phone_digits === a[0]) : [] }), first: async () => null, run: async () => ({}) }) }),
  batch: async () => [],
});
const submit = async (path, fields, env, ua = '') => {
  const writes = [];
  const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields, ua }) }), params: { path: ['submit'] }, env: { APPLY_KV: { put: async (k, v) => writes.push([k, v]) }, ...env }, waitUntil: () => {} });
  const rec = writes.find(([k]) => k.startsWith('s:'));
  return { res, record: rec ? JSON.parse(rec[1]) : null };
};

test('5기 재참여 폼 넷은 5,900원 고정이고 지역 선택에 안 나온다', () => {
  for (const path of [...phoneOnly, ...invite]) {
    const f = formOf(path);
    assert.equal(f.cohort, '5'); assert.equal(f.plan, 'discount'); assert.equal(f.fee, 5900); assert.equal(f.rejoin, true);
    assert.match(f.pay, /\/b\/$/); assert.equal(f.friendFee, undefined);
    assert.ok(!listedForms().some((x) => x.path === path));
  }
  for (const path of phoneOnly) { assert.equal(feeLabel(formOf(path)), '재참여 5,900원'); assert.equal(formOf(path).friendForm, path + 'friend/'); }
  for (const path of invite) { assert.equal(feeLabel(formOf(path)), '친구 초대 5,900원'); assert.equal(formOf(path).phoneOnly, undefined); }
});

test('전화번호만 받는 폼은 지난 신청에서 성별/출생년도/학교를 가져오고 화면이 보낸 값은 안 믿는다', async () => {
  const rows = [
    { application_id: 'new', phone_digits: '01011112222', gender: '여성', birth_year: '', school: '', device: '' },
    { application_id: 'old', phone_digits: '01011112222', gender: '여성', birth_year: '2003', school: '테스트대', device: 'Android' },
  ];
  const { res, record } = await submit(phoneOnly[0], { phone: '010-1111-2222', consent: '동의합니다', name: '지난참가', gender: '남성', source: '그 외' }, { DB: db(rows) });
  assert.equal(res.status, 200);
  assert.deepEqual([record.fields.gender, record.fields.birth_year, record.fields.school, record.fields.device], ['여성', '2003', '테스트대', 'Android']);
  assert.equal('source' in record.fields, false);
  assert.equal(record.prior_from, 'new');
  assert.equal(record.hidden.plan, 'discount'); assert.equal(record.hidden.cohort, '5');
  const phone = await submit(phoneOnly[0], { phone: '01011112222', consent: '동의합니다', name: '지난참가' }, { DB: db(rows) }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  assert.equal(phone.record.fields.device, 'iPhone');
});

test('지난 신청을 못 찾아도 접수는 받고, 이름이 없으면 거부한다', async () => {
  const { res, record } = await submit(phoneOnly[1], { phone: '01099998888', name: '처음' }, { DB: db([]) });
  assert.equal(res.status, 200);
  assert.equal(record.prior_from, ''); assert.equal(record.fields.gender, undefined);
  const bad = await submit(phoneOnly[1], { phone: '01099998888', consent: '동의합니다' }, {});
  assert.equal(bad.res.status, 400); assert.deepEqual((await bad.res.json()).miss, ['name']);
});

test('친구 초대 폼은 기본 문항을 그대로 받는다', async () => {
  const bad = await submit(invite[0], { phone: '01099998888', consent: '동의합니다', name: '친구' }, {});
  assert.deepEqual((await bad.res.json()).miss, ['gender', 'birth_year', 'school', 'device']);
  const ok = await submit(invite[0], { gender: '남성', birth_year: '2002', school: '테스트대', device: 'iPhone', phone: '01099998888', consent: '동의합니다', name: '친구' }, {});
  assert.equal(ok.res.status, 200); assert.equal('prior_from' in ok.record, false);
});

test('전화번호만 받는 폼 화면: 한 페이지에 전화번호, 친구 문항, 참가비, 제출. 공유는 친구 초대 폼으로', () => {
  for (const path of phoneOnly) {
    const html = read(path), p1 = sec(html, 1);
    for (const word of ['data-page="2"', 'data-page="3"', 'data-next=', 'data-prev=', '<input type="checkbox" name="consent"']) assert.equal(html.includes(word), false, path + ' ' + word);
    for (const n of ['gender', 'birth_year', 'school', 'source', 'device', 'intent']) assert.equal(html.includes('<div class="q" data-name="' + n + '"') || html.includes('<input type="radio" name="' + n + '"'), false, path + ' ' + n);
    const at = (x) => { const i = p1.indexOf(x); assert.ok(i >= 0, path + ' ' + x); return i; };
    assert.ok(at('<div class="q" data-name="phone">') < at('class="rj-privacy"') && at('class="rj-privacy"') < at('data-name="buddy_room"') && at('data-name="buddy_room"') < at('<div class="q" data-name="name">')
      && at('<div class="q" data-name="name">') < at('id="submit"'));
    assert.ok(at('친구에게 추천해 주세요') < at('친구에게 할인 링크 보내기') && at('친구에게 할인 링크 보내기') < at('class="rj-room"') && at('class="rj-room"') < at('name="buddy_room" value="같은 방"'));
    assert.equal(p1.includes('함께 신청해요'), false);
    assert.ok(p1.includes('지난 신청 때 적어 주신 성별, 출생년도, 학교'));
    for (const id of ['ld-flow', 'ld-qa', 'ld-review', 'ld-guide']) assert.ok(p1.includes('id="' + id + '"'), path + ' ' + id);   // 소개는 다른 개선판 폼과 같게 둠
    assert.ok(p1.includes('10월 15일(목) ~ 10월 17일(토)') && p1.includes('먼저 신청한 순서대로'));
    assert.equal((p1.match(/class="fr-share"/g) || []).length, 1);
    assert.equal(html.includes('12,900'), false, '비교용 정가 제거');
    assert.ok(p1.includes('<p class="fee-was"><strong>5,900원</strong></p>'));
    assert.match(p1, /id="pay" href="https:\/\/haruharu-pay.pages.dev\/b\/"/);
    assert.ok(html.includes("var url=location.origin+'" + path + "friend/'+'?'+g+'src=h5-friend-rejoin';"));
  }
  for (const path of invite) {
    const html = read(path);
    assert.ok(sec(html, 1).includes('name="gender"') && sec(html, 2).includes('data-name="phone"') && sec(html, 3).includes('5,900원'));
    assert.ok(html.includes("var url=location.origin+location.pathname+'?'+g+'src=h5-friend-rejoin';"));
  }
});
