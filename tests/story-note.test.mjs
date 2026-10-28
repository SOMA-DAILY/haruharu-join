import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

// 10/28 사용자: 제출 전에 (선택)으로 기타 사항, 특이점이나 그런 거 아무거나 적는 항목 (이야기판 신청서)
const T = (iso) => Date.parse(iso);
const page = (p) => readFileSync(new URL('../public' + p + 'index.html', import.meta.url), 'utf8');

test('빌드 결과: 이야기판 신청서 3페이지 제출 버튼 바로 앞에 선택 글 칸, 다른 폼에는 없음', () => {
  const html = page('/8/seoul/story/');
  const p3 = html.slice(html.indexOf('<section class="page" data-page="3">'), html.indexOf('<section class="page" data-page="done">'));
  assert.match(p3, /<div class="q" data-name="note"><p class="t">기타 사항<span class="opt-t">\(선택\)<\/span><\/p>\n <p class="qh">[^<]+<\/p>\n <textarea name="note" rows="3" maxlength="500"[^>]*><\/textarea><\/div>\n\n<div class="nav">[^\n]*id="submit"/);
  assert.ok(!/<textarea name="note"[^>]*required/.test(html), '필수 아님');
  for (const p of ['/8/seoul/', '/9/seoul/', '/8/seoul/_b/']) assert.equal(page(p).includes('name="note"'), false, p);
});

const submit = async (fields, db) => {
  const writes = [];
  const env = { APPLY_KV: { put: async (k, v) => writes.push([k, v]) } };
  if (db) env.DB = db;
  const res = await onRequest({ request: new Request('http://localhost/api/submit', { method: 'POST', body: JSON.stringify({ path: '/8/seoul/story/', fields: { gender: '여성', birth_year: '2003', school: '시험대', consent: '동의합니다', phone: '01010000002', name: '기타검증', ...fields }, hidden: {} }) }), params: { path: ['submit'] }, env, waitUntil: () => {} });
  const rec = writes.find(([k]) => k.startsWith('s:'));
  return { status: res.status, rec: rec ? JSON.parse(rec[1]) : null };
};

test('서버: 기타 사항은 비워도 접수, 적으면 KV 정본에 500자까지, D1 은 batch 밖 note 열', async () => {
  const now = Date.now; Date.now = () => T('2026-10-28T15:00:00+09:00');
  try {
    const none = await submit({});
    assert.equal(none.status, 200); assert.equal(none.rec.fields.note, undefined);
    const sql = [];
    const db = { prepare: (q) => ({ bind: (...a) => ({ q, a, run: async () => { sql.push([q, a]); return {}; } }) }), batch: async () => [] };
    const one = await submit({ note: '둘째 날 저녁에는 일정이 있어요' }, db);
    assert.equal(one.status, 200); assert.equal(one.rec.fields.note, '둘째 날 저녁에는 일정이 있어요');
    const up = sql.find(([q]) => q.startsWith('UPDATE submissions SET note'));
    assert.ok(up, 'note 열 갱신'); assert.equal(up[1][1], '둘째 날 저녁에는 일정이 있어요');
    const long = await submit({ note: '가'.repeat(700) });
    assert.equal(long.rec.fields.note.length, 500);
  } finally { Date.now = now; }
});

test('CSV: 기타 사항은 맨 끝 열 (기존 열 위치 그대로)', async () => {
  const rec = { id: 'a1', application_id: 'a1', submitted_at: '2026-10-28 15:00', fields: { name: '기타검증', note: '=특이 사항, 줄\n바꿈' }, hidden: { arm: 'a' }, track: 'student', ts: 1 };
  const env = { EXPORT_TOKEN: 't', APPLY_KV: { list: async () => ({ keys: [{ name: 's:1' }], list_complete: true }), get: async () => rec } };
  const res = await onRequest({ request: new Request('http://localhost/api/export?token=t'), params: { path: ['export'] }, env, waitUntil: () => {} });
  const text = await res.text();
  const head = text.split('\n')[0].split(',');
  assert.deepEqual(head.slice(-3), ['track', 'arm', 'note']);
  assert.ok(text.includes(`"'=특이 사항, 줄\n바꿈"`) || text.includes(`'=특이 사항`), '수식으로 읽히지 않게');
});
