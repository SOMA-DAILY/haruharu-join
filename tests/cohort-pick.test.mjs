import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entryTarget, pickTarget, FORMS } from '../shared/forms.mjs';
import { onRequest } from '../functions/api/[[path]].js';

// 10/23 사용자: 신청 안내 바로 아래(성별 앞)에 8기, 9기 일정 카드, 그 자리에서 골라서 신청 (스크롤 이동, 화면 바뀜 없이)
const T = (iso) => Date.parse(iso);
const page = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');
const block = (html) => { const a = html.indexOf('<div class="pk" id="pick"'); return a < 0 ? '' : html.slice(a, html.indexOf('\n</div>', a)); };

test('등록부: pick 은 8기, 9기 서울 정가 폼만, 고정 링크는 그대로 마감 이른 기수로, pickTarget 은 같은 고정 링크의 pick 줄만', () => {
  assert.deepEqual(Object.keys(FORMS).filter((p) => FORMS[p].pick && FORMS[p].plan === 'regular'), ['/8/seoul/', '/9/seoul/']);
  assert.equal(entryTarget('/seoul/student/', T('2026-10-23T15:00:00+09:00')), '/8/seoul/');
  assert.equal(entryTarget('/seoul/student/', T('2026-10-29T18:00:00+09:00')), '/9/seoul/');
  assert.equal(pickTarget('/8/seoul/', '9'), '/9/seoul/');
  assert.equal(pickTarget('/9/seoul/', '8'), '/8/seoul/');
  assert.equal(pickTarget('/8/seoul/', '8'), '/8/seoul/');
  assert.equal(pickTarget('/8/seoul/', '7'), null);
  assert.equal(pickTarget('/7/seoul/', '9'), null);   // pick 아닌 폼
});

test('빌드 결과: 8기(A, B 팔)와 9기 폼의 성별 문항 바로 앞에 두 기수 카드, 지금 기수가 골라진 채, 이동 링크 없음', () => {
  for (const [p, own] of [['/8/seoul/', '8'], ['/8/seoul/_b/', '8'], ['/9/seoul/', '9']]) {
    const html = page(p), b = block(html);
    assert.ok(b, p);
    assert.match(html.slice(html.indexOf('<div class="pk" id="pick"')), /^<div class="pk" id="pick"[^>]*>[\s\S]*?\n<\/div>\n\n<div class="q" data-name="gender">/, p + ' 성별 바로 앞');
    assert.ok(b.includes(`data-own="${own}"`), p);
    assert.ok(b.includes('<input type="hidden" name="cohort_pick" value="">'), p + ' 숨은 칸은 비어 있음 (지금 기수)');
    const cards = [...b.matchAll(/<button type="button" class="pk-c( on)?" role="radio" aria-checked="(true|false)" data-cohort="(\d+)" data-deadline="(\d+)"/g)].map((m) => [m[3], Number(m[4]), !!m[1], m[2]]);
    assert.deepEqual(cards, [['8', T('2026-10-29T18:00:00+09:00'), own === '8', String(own === '8')], ['9', T('2026-11-05T18:00:00+09:00'), own === '9', String(own === '9')]], p);
    for (const s of ['10/30(금) ~ 11/1(일)', '10/29(목) 18:00 신청 마감', '11/6(금) ~ 11/8(일)', '11/5(목) 18:00 신청 마감']) assert.ok(b.includes(s), p + ' ' + s);
    const shown = b.replace(/<[^>]*>/g, '');
    for (const s of ['성비', '수도권', '년생', '자리', '원']) assert.ok(!shown.includes(s), p + ' ' + s);   // 성비, 지역, 나이, 금액 표기 없음
    const js = html.slice(html.indexOf("var box=document.getElementById('pick')"), html.indexOf('</script>', html.indexOf("var box=document.getElementById('pick')")));
    assert.ok(!/href=|#pick/.test(b) && !/location|scrollIntoView|scrollTo|data-mode/.test(js), p + ' 페이지 이동, 스크롤, 화면 바뀜 없음');
    assert.equal((html.match(/var box=document\.getElementById\('pick'\)/g) || []).length, 1, p);
    assert.ok(html.includes("function target(){ return document.getElementById('pick')||"), p + ' 아래 고정 버튼 기준');
  }
});

test('빌드 결과: pick 없는 폼에는 카드 없음', () => {
  for (const p of ['/7/seoul/', '/6/seoul/', '/rejoin/6/seoul/']) assert.equal(page(p).includes('id="pick"'), false, p);
});

const submit = async (path, extra = {}) => {
  const writes = [];
  const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path, fields: { gender: '여성', birth_year: '2003', school: '시험대', source: '인스타그램 광고', device: '아이폰', consent: '동의합니다', phone: '01010000001', name: '기수검증', ...extra }, hidden: { cohort: '8', plan: 'regular' } }) }), params: { path: ['submit'] }, env: { APPLY_KV: { put: async (k, v) => writes.push([k, v]) } }, waitUntil: () => {} });
  const rec = writes.find(([k]) => k.startsWith('s:'));
  return { status: res.status, body: await res.json(), rec: rec ? JSON.parse(rec[1]) : null };
};

test('서버: 8기 폼에서 9기를 고르면 9기 줄로 접수(from_page 8기), 안 고르면 그대로, 엉뚱한 값은 400, 고른 기수가 마감이면 409', async () => {
  const now = Date.now; Date.now = () => T('2026-10-23T15:00:00+09:00');
  try {
    const picked = await submit('/8/seoul/', { cohort_pick: '9' });
    assert.equal(picked.status, 200);
    assert.equal(picked.rec.hidden.cohort, '9'); assert.equal(picked.rec.from_page, '/8/seoul/');
    const plain = await submit('/8/seoul/');
    assert.equal(plain.status, 200); assert.equal(plain.rec.hidden.cohort, '8'); assert.equal(plain.rec.from_page, undefined);
    const back = await submit('/9/seoul/', { cohort_pick: '8' });
    assert.equal(back.status, 200); assert.equal(back.rec.hidden.cohort, '8'); assert.equal(back.rec.from_page, '/9/seoul/');
    const bad = await submit('/8/seoul/', { cohort_pick: '7' });
    assert.equal(bad.status, 400); assert.equal(bad.rec, null);
    const other = await submit('/7/seoul/rejoin/from-6/', { cohort_pick: '9' });   // pick 아닌 폼은 값을 무시 (7기는 마감이라 409)
    assert.equal(other.body.cohort, '7');
    Date.now = () => T('2026-10-29T18:00:00+09:00');
    const late = await submit('/9/seoul/', { cohort_pick: '8' });
    assert.equal(late.status, 409); assert.equal(late.rec, null);
  } finally { Date.now = now; }
});
