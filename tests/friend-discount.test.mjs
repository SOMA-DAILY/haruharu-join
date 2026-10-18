import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';
import { formOf, FORMS } from '../shared/forms.mjs';
import { friendFee } from '../shared/friend-discount.mjs';

const seoul = formOf('/4/seoul/v2/');   // 친구 할인은 개선판 정가 폼에만
const V2 = Object.keys(FORMS).filter((p) => FORMS[p].variant === 'v2' && !FORMS[p].rejoin && FORMS[p].cohort === '4');   // 4기 개선판 3곳 (5기 개선판은 지역 선택에 나옴, 아래 따로). 재참여 폼은 rejoin.test.mjs에서 별도로 검증
const OLD4 = Object.keys(FORMS).filter((p) => FORMS[p].cohort === '4' && !FORMS[p].variant);
const me = '010-1000-0001';
const open = Date.parse('2026-10-09T12:00:00+09:00');   // 4기 모집 중인 시각
async function at(ms, fn) { const o = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = o; } }

test('친구 할인은 개선판 정가 폼에만 있고 금액은 정가보다 2,000원 낮다', () => {
  const on = Object.keys(FORMS).filter((p) => FORMS[p].friendFee && !FORMS[p].survey);   // 재참여 설문 폼(설문 할인 + 친구 할인)은 rejoin-survey.test.mjs 에서 따로
  assert.deepEqual(on.sort(), ['/4/gwangju/v2/', '/4/seoul/v2/', '/5/gwangju/', '/5/seoul/', '/6/seoul/', '/7/seoul/']);
  for (const p of on) {
    assert.equal(FORMS[p].plan, 'regular', p);
    assert.equal(FORMS[p].fee - FORMS[p].friendFee, 2000, p);
    assert.match(FORMS[p].friendPay, /\/b\/$/, p);
  }
});

test('친구 번호를 맞게 적어야만 할인 금액이 된다', () => {
  const f = (o) => friendFee(seoul, { phone: me, ...o });
  assert.equal(f({ buddy_room: '같은 방', buddy: '010-1000-0002' }), 5900);
  assert.equal(f({ buddy_room: '다른 방', buddy: '01010000002' }), 5900);
  assert.equal(f({ buddy_room: '상관없음', buddy: '010 1000 0002' }), 5900);
  assert.equal(f({ buddy_room: '혼자', buddy: '010-1000-0002' }), 0, '혼자 신청');
  assert.equal(f({ buddy: '010-1000-0002' }), 0, '친구 문항 안 고름');
  assert.equal(f({ buddy_room: '같은 방' }), 0, '번호 없음');
  assert.equal(f({ buddy_room: '같은 방', buddy: '010-1234' }), 0, '번호 꼴이 아님');
  assert.equal(f({ buddy_room: '같은 방', buddy: '02-123-4567' }), 0, '휴대폰 번호가 아님');
  assert.equal(f({ buddy_room: '같은 방', buddy: '01010000001' }), 0, '내 번호를 적음');
  assert.equal(friendFee(formOf('/4/seoul/x7q2/'), { phone: me, buddy_room: '같은 방', buddy: '010-1000-0002' }), 0, '할인 링크 폼은 대상 아님');
  assert.equal(friendFee(formOf('/seoul/'), { phone: me, buddy_room: '같은 방', buddy: '010-1000-0002' }), 0, '3기 폼은 대상 아님');
  assert.equal(friendFee(formOf('/4/seoul/'), { phone: me, buddy_room: '같은 방', buddy: '010-1000-0002' }), 0, '기존 4기 정가 폼은 대상 아님');
  assert.equal(friendFee(null, {}), 0);
});

test('제출 때 서버가 안내 금액을 정해서 남긴다 (클라이언트가 보낸 값은 안 씀)', async () => {
  const base = { gender: '여성', birth_year: '2003', school: '시험대', source: '인스타그램 광고', device: '아이폰', consent: '동의합니다', name: '시험', phone: me };
  const submit = async (path, extra) => {
    const writes = [];
    const env = { APPLY_KV: { put: async (k, v) => writes.push([k, v]) } };
    const res = await at(open, () => onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields: { ...base, ...extra }, hidden: {}, friend_fee: 1 }) }), params: { path: ['submit'] }, env, waitUntil: () => {} }));
    assert.equal(res.status, 200, path);
    return JSON.parse(writes.find(([k]) => k.startsWith('s:'))[1]);
  };
  assert.equal((await submit('/4/seoul/v2/', { buddy_room: '같은 방', buddy: '010-1000-0002' })).friend_fee, 5900);
  assert.equal((await submit('/4/seoul/v2/', { buddy_room: '혼자' })).friend_fee, 0);
  assert.equal((await submit('/4/seoul/v2/', { buddy_room: '같은 방', buddy: me })).friend_fee, 0);
  assert.equal('friend_fee' in (await submit('/4/seoul/', { buddy_room: '같은 방', buddy: '010-1000-0002' })), false, '기존 폼은 칸 자체가 없음');
  assert.equal('friend_fee' in (await submit('/4/seoul/x7q2/', { buddy_room: '같은 방', buddy: '010-1000-0002' })), false, '대상 아닌 폼은 칸 자체가 없음');
});

const read = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');
const sec = (html, n) => { const m = html.match(new RegExp('<section class="page[^"]*" data-page="' + n + '">([\\s\\S]*?)(?=<section class="page|</form>)')); return m ? m[1] : null; };
const qs = (s) => [...s.matchAll(/<div class="q" data-name="(\w+)"/g)].map((m) => m[1]);

test('개선판은 새 주소 세 곳이고 이름은 기존 이름 뒤에 - 개선, 지역 선택에는 안 나온다', () => {
  assert.deepEqual(V2.sort(), ['/4/gwangju/v2/', '/4/seoul-work/pre/v2/', '/4/seoul/v2/']);
  for (const p of V2) {
    const base = FORMS[p.replace(/v2\/$/, '')];
    assert.ok(base && !base.variant, p + ' 짝이 되는 기존 폼');
    assert.equal(FORMS[p].label, base.label + ' - 개선', p);
    assert.equal(FORMS[p].plan, base.plan, p); assert.equal(FORMS[p].track, base.track, p); assert.equal(FORMS[p].fee, base.fee, p);
    assert.equal(!!FORMS[p].listed, false, p);
  }
  // 5기부터는 개선판(B) 하나로 감 (10/10) → 지역 선택 버튼은 5기 개선판, 4기 개선판은 여전히 안 나옴
  const select = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.equal(select.includes('/4/seoul/v2/'), false, '지역 선택 화면');
  assert.ok(select.includes('href="/7/seoul/"') && !select.includes('href="/6/') && !select.includes('href="/5/'), '7기 버튼 (10/17: 7기 서울만, 광주 없음)');
});

test('기존 4기 폼에는 개선판 요소가 하나도 없다 (2페이지 구성 그대로)', () => {
  for (const p of OLD4) {
    const html = read(p);
    for (const mark of ['data-page="3"', 'fr-fee', 'fr-share', 'fee-was', 'ap-get', '/b/', '12,900', 'L_store_feed', '배정해주세요']) assert.equal(html.includes(mark), false, p + ' ' + mark);
    assert.ok(sec(html, 2).includes('id="submit"') && qs(sec(html, 2)).includes('phone'), p);
  }
});

test('개선판 정가 폼: 3페이지(기본 문항 / 전화번호와 동의 / 친구 문항과 참가비), 참가비는 3페이지에서 처음', () => {
  for (const p of V2.filter((x) => FORMS[x].plan !== 'prealert')) {
    const html = read(p); const [p1, p2, p3] = [sec(html, 1), sec(html, 2), sec(html, 3)];
    assert.deepEqual(qs(p2), ['phone', 'consent'], p + ' 2페이지는 전화번호와 동의만');
    assert.ok(!qs(p1).includes('phone') && !qs(p1).includes('consent'), p);
    assert.ok(qs(p3).indexOf('buddy_room') >= 0 && qs(p3).indexOf('buddy_room') < qs(p3).indexOf('name'), p + ' 친구 문항이 참가비 안내보다 먼저');
    assert.ok(p1.includes('data-next="2"') && p2.includes('data-prev="1"') && p2.includes('data-next="3"') && p3.includes('data-prev="2"') && p3.includes('id="submit"') && !p2.includes('id="submit"'), p + ' 이동 버튼');
    for (const w of ['참가비', '송금', '12,900', 'fr-']) assert.equal((p1 + p2).includes(w), false, p + ' 1, 2페이지에 ' + w);
    assert.equal((p3.match(/class="fr-fee"/g) || []).length, 3, p);
    assert.ok(html.includes(FORMS[p].friendPay), p);
    assert.equal((html.match(/class="fr-share"/g) || []).length, 1, p + ' 공유 버튼은 친구 문항에만');
    assert.ok(p3.split('data-name="name"')[0].includes('class="fr-share"'), p);
    assert.ok(p3.includes('<p class="fee-was"><s>12,900원</s> → <strong>7,900원</strong></p>'), p + ' 정가 표시');
  }
});

test('개선판 완료 화면: 정가 폼에는 앱 설치 안내(스토어 두 곳)만, 사전알림 폼은 2페이지에 설치 안내 없음', () => {
  for (const p of V2) {
    const html = read(p); const done = html.split('data-page="done"')[1].split('</section>')[0];
    const has = done.includes('href="https://apps.apple.com/kr/app/id6790147623"') && done.includes('href="https://play.google.com/store/apps/details?id=com.somadaily.haruharu"');
    assert.equal(has, FORMS[p].plan !== 'prealert', p);
    assert.equal(done.includes('fr-'), false, p + ' 완료 화면에 친구 카드 없음');
    assert.equal(html.split('data-page="done"')[0].includes('ap-get'), false, p + ' 완료 화면 앞에는 없음');
    if (FORMS[p].plan === 'prealert') { assert.equal(sec(html, 3), null, p); assert.deepEqual(qs(sec(html, 2)), ['phone', 'consent'], p); assert.ok(sec(html, 2).includes('id="submit"'), p); }
  }
});
