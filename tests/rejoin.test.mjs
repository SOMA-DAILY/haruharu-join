import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formOf, feeLabel, listedForms, formStatus, COHORT_DEADLINES } from '../shared/forms.mjs';
import { friendFee } from '../shared/friend-discount.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const paths = ['/4/seoul/rejoin/', '/4/gwangju/rejoin/'];
const read = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');
const sec = (html, n) => {
  const m = html.match(new RegExp('<section class="page[^\"]*" data-page="' + n + '">([\\s\\S]*?)(?=<section class="page|</form>)'));
  assert.ok(m, '폼 페이지 ' + n);
  return m[1];
};
const fields = { gender: '여성', birth_year: '2003', school: '테스트대', device: 'iPhone', phone: '01010000001', consent: '동의합니다', name: '재참여테스트', buddy_room: '같은 방', buddy: '01010000002' };

test('서울/광주 재참여는 개선 화면을 쓰는 4,900원 할인 폼이고 중복 할인과 공개 지역 선택에서 제외된다', () => {
  for (const path of paths) {
    const form = formOf(path);
    assert.ok(form, path);
    assert.equal(form.variant, 'v2');
    assert.equal(form.plan, 'discount');
    assert.equal(form.fee, 4900);
    assert.equal(form.rejoin, true);
    assert.match(form.pay, /\/e\/$/);
    assert.equal(feeLabel(form), '재참여 4,900원');
    assert.equal(friendFee(form, fields), 0);
    assert.equal(form.friendFee, undefined);
    assert.equal(form.listFee, 12900);
    assert.ok(!listedForms().some((f) => f.path === path));
    assert.equal(formStatus(path, Date.parse(COHORT_DEADLINES['4']) - 1).open, true);
    assert.equal(formStatus(path, Date.parse(COHORT_DEADLINES['4'])).open, false);
  }
});

test('재참여 제출은 서버가 기수/지역/할인 요금제를 확정하고 친구 할인 금액을 기록하지 않는다', async () => {
  for (const path of paths) {
    const writes = [];
    const env = { COHORT_DEADLINE: '2099-01-01T00:00:00+09:00', APPLY_KV: { put: async (k, v) => writes.push([k, v]) } };
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields, hidden: { city: 'wrong', cohort: '3', plan: 'regular' }, friend_fee: 2900 }) }), params: { path: ['submit'] }, env, waitUntil: () => {} });
    assert.equal(res.status, 200, path);
    const record = JSON.parse(writes.find(([k]) => k.startsWith('s:'))[1]);
    assert.equal(record.hidden.plan, 'discount');
    assert.equal(record.hidden.cohort, '4');
    assert.equal(record.hidden.city, path.includes('/seoul/') ? 'seoul' : 'gwangju');
    assert.equal(record.track, record.hidden.city + '-student');
    assert.equal('friend_fee' in record, false);
    assert.equal('source' in record.fields, false);
    assert.equal('intent' in record.fields, false);
  }
});

test('재참여는 기기 필수를 유지하고 다른 폼은 유입 경로를 계속 필수로 받는다', async () => {
  const cases = [
    ...paths.map((path) => ({ path, input: { ...fields, device: '' }, miss: ['device'] })),
    ...['/4/seoul/v2/', '/4/gwangju/v2/', '/4/seoul/x7q2/', '/4/seoul-work/pre/', '/4/seoul-work/pre/v2/']
      .map((path) => ({ path, input: { ...fields, schedule_pref: '평일 3일도 괜찮아요' }, miss: ['source'] })),
  ];
  for (const { path, input, miss } of cases) {
    const writes = [];
    const env = { COHORT_DEADLINE: '2099-01-01T00:00:00+09:00', APPLY_KV: { put: async (k, v) => writes.push([k, v]) } };
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields: input }) }), params: { path: ['submit'] }, env, waitUntil: () => {} });
    assert.equal(res.status, 400, path);
    assert.deepEqual((await res.json()).miss, miss, path);
    assert.equal(writes.length, 0);
  }
});

test('재참여 마감 뒤에는 서버도 접수를 거부하고 저장하지 않는다', async () => {
  for (const path of paths) {
    const writes = [];
    const env = { COHORT_DEADLINE: '2000-01-01T00:00:00+09:00', APPLY_KV: { put: async (k, v) => writes.push([k, v]) } };
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields }) }), params: { path: ['submit'] }, env });
    assert.equal(res.status, 409, path);
    assert.equal((await res.json()).error, 'cohort_closed');
    assert.equal(writes.length, 0);
  }
});

test('재참여 폼은 연락처/동의와 참가비 페이지가 나뉘고 참가비 안내와 송금 모두 4,900원이다', () => {
  for (const path of paths) {
    const html = read(path), p1 = sec(html, 1), p2 = sec(html, 2), p3 = sec(html, 3);
    assert.match(p1, /name="device"[^>]*required/);
    for (const name of ['source', 'intent', 'intent_other']) assert.equal(p1.includes('name="' + name + '"'), false, path + ' ' + name + ' 문항 제거');
    assert.ok(p2.includes('data-name="phone"') && p2.includes('data-name="consent"'));
    assert.ok(p3.includes('data-name="name"') && p3.includes('data-name="buddy_room"') && p3.includes('id="submit"'));
    for (const word of ['참가비', '송금', '4,900원']) assert.equal((p1 + p2).includes(word), false, path + ' ' + word);
    assert.match(p3, /재참여[\s\S]*4,900원/);
    assert.match(p3, /id="pay" href="https:\/\/haruharu-pay.pages.dev\/e\/"/);
    assert.ok(p3.includes('<p class="fee-was"><s>12,900원</s> → <strong>4,900원</strong></p>'), path + ' 할인 표시');
    assert.equal((p3.match(/class="fr-share"/g) || []).length, 1, path + ' 친구 공유 버튼');
    assert.ok(p3.indexOf('data-name="buddy_room"') < p3.indexOf('data-name="name"'), path + ' 친구 문항 먼저');
    for (const word of ['7,900원', '5,900원', '사전 알림을 신청해', 'class="fr-on"', 'class="fr-fee"']) assert.equal(p3.includes(word), false, path + ' ' + word);
  }
});
