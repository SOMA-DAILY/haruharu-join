import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

const read = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');
const base = { gender: '여성', birth_year: '2003', school: '서울대학교', source: '그 외', device: 'iPhone', phone: '01012345678', consent: '동의합니다', name: '홍길동' };
const submit = async (fields) => {
  const real = Date.now; Date.now = () => Date.parse('2026-10-14T09:00:00+09:00');
  try {
    const writes = [];
    const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path: '/5/seoul/', fields, ua: 'iPhone' }) }), params: { path: ['submit'] }, env: { APPLY_KV: { put: async (k, v) => writes.push([k, v]) } }, waitUntil: () => {} });
    const rec = writes.find(([k]) => k.startsWith('s:'));
    return { res, record: rec ? JSON.parse(rec[1]) : null };
  } finally { Date.now = real; }
};

test('5기 정가 폼 동의 문항: 모두 동의 + 필수 개인정보 + 선택 문자 수신', () => {
  for (const path of ['/5/seoul/', '/5/gwangju/']) {
    const html = read(path);
    const q = html.match(/<div class="q" data-name="consent">([\s\S]*?)<\/div>\n/)[1];
    assert.ok(q.includes('id="agAll">모두 동의'));
    assert.ok(q.includes('<input type="checkbox" name="consent" value="동의합니다" required>'));
    assert.ok(q.includes('<input type="checkbox" name="marketing" value="동의합니다">'));   // 선택이라 required 없음
    assert.ok(q.indexOf('id="agAll"') < q.indexOf('name="consent"') && q.indexOf('name="consent"') < q.indexOf('name="marketing"'));
    for (const need of ['<b>(필수)</b> 개인정보 수집 이용 동의', '<b>(선택)</b> 할인, 모집 소식 문자 받기', '신청을 끝까지 마치지 않아도', '언제든 수신 거부', '동의하지 않아도 신청할 수 있어요', '동의하지 않으면 신청이 어렵습니다'])
      assert.ok(q.includes(need), path + ' 에 없음: ' + need);
    // 동의 문항은 여전히 2페이지(전화번호와 함께)
    const p2 = html.split('data-page="2"')[1].split('data-page="3"')[0];
    assert.ok(p2.includes('name="marketing"') && p2.includes('<div class="q" data-name="phone">'));
    for (const code of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) assert.doesNotThrow(() => new Function(code));
  }
  assert.ok(!read('/5/seoul/rejoin/friend/').includes('name="marketing"'));   // 다른 폼은 그대로
});

test('서버: 문자 수신 동의는 선택이고, 한 사람만 기록에 남는다', async () => {
  const no = await submit(base);
  assert.equal(no.res.status, 200); assert.equal(no.record.fields.marketing, undefined);
  const yes = await submit({ ...base, marketing: '동의합니다' });
  assert.equal(yes.res.status, 200); assert.equal(yes.record.fields.marketing, '동의합니다');
});
