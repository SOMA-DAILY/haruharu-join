import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as api } from '../functions/api/[[path]].js';
import { formStatus } from '../shared/forms.mjs';

const NOW = Date.parse('2026-10-22T15:00:00+09:00');
const PAGE = '/rejoin/6/seoul/';
const JOIN7 = '/7/seoul/rejoin/from-6/';
const JOIN8 = '/8/seoul/rejoin/from-6/';
const feedback = { sv_review: '가상 검증: 일상을 나누며 대화할 수 있어서 좋았어요.', sv_wish: '가상 검증: 다음에는 대화 주제가 더 다양했으면 좋겠어요.' };
async function withClock(fn) { const old = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = old; } }
async function visit(path, method = 'GET') {
  return withClock(() => middleware({ request: new Request('https://join.haruharu.co.kr' + path, { method }), env: {}, next: async () => new Response('unchanged') }));
}
async function submit(path, fields, g, prior = []) {
  const writes = [], runs = [];
  const DB = {
    prepare: sql => ({ bind: (...args) => ({ sql, args,
      all: async () => ({ results: /FROM submissions WHERE phone_digits/.test(sql) ? prior : [] }),
      run: async () => { runs.push({ sql, args }); return {}; } }) }),
    batch: async statements => { runs.push(...statements); return []; },
  };
  const response = await withClock(() => api({ request: new Request('https://local.test/api/submit', { method: 'POST',
    body: JSON.stringify({ path, fields, hidden: { g }, sid: '00000000-0000-4000-8000-000000000222' }) }), params: { path: ['submit'] },
    env: { DB, APPLY_KV: { put: async (key,value) => writes.push({ key,value }) } }, waitUntil() {} }));
  return { response, writes, runs };
}

test('발송한 남녀 공용 링크는 6기 전용 폼으로 302, g와 추적 쿼리 보존', async () => {
  for (const g of ['m', 'f']) {
    const response = await visit('/rejoin/seoul/?src=rejoin-msg&g=' + g + '&utm_source=sms');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const url = new URL(response.headers.get('location'), 'https://join.haruharu.co.kr');
    assert.equal(url.pathname, PAGE);
    assert.equal(url.searchParams.get('src'), 'rejoin-6-msg');
    assert.equal(url.searchParams.get('g'), g);
    assert.equal(url.searchParams.get('utm_source'), 'sms');
  }
  assert.equal((await visit('/rejoin/seoul/?src=rejoin-msg&g=m', 'HEAD')).status, 302);
});

test('6기 목적지·다른 유입·POST에는 리다이렉트 루프/동작 변경 없음', async () => {
  for (const [path, method] of [[PAGE + '?src=rejoin-6-msg&g=m','GET'],
    ['/rejoin/seoul/?src=other&g=m','GET'],['/rejoin/seoul/','GET'],
    ['/rejoin/seoul/?src=rejoin-msg&g=m','POST']]) {
    const response = await visit(path,method);
    assert.equal(response.status,200);
    assert.equal(await response.text(),'unchanged');
  }
});

test('남성 7기는 마감, 여성 7기와 남성 8기는 기존 일정대로 열림', async () => {
  for (const path of ['/7/seoul/', '/7/seoul/rejoin/', JOIN7]) {
    assert.equal(formStatus(path,NOW,{},'m').open,false,path);
    assert.equal(formStatus(path,NOW,{},'f').open,true,path);
    const response = await withClock(() => api({ request: new Request('https://local.test/api/cohort?path='+encodeURIComponent(path)+'&g=m'),params:{path:['cohort']},env:{} }));
    assert.equal((await response.json()).open,false);
  }
  assert.equal(formStatus(JOIN8,NOW,{},'m').open,true);
  const direct = await visit('/7/seoul/?g=m&src=direct');
  assert.equal(direct.status,302);
  assert.match(direct.headers.get('location'),/^\/8\/seoul\/\?/);
  const cookie = await withClock(() => api({request:new Request('https://local.test/api/cohort?path='+encodeURIComponent(JOIN7),
    {headers:{cookie:'hh_g=m'}}),params:{path:['cohort']},env:{}}));
  assert.equal((await cookie.json()).open,false);
});

test('남성의 7기 신청은 링크/직접 신청/기존 프로필 모두 저장 전에 차단', async () => {
  for (const [path, fields, g, prior] of [
    [PAGE,{...feedback,sv_join:'7기',phone:'01000000001',name:'합성 검증'},'m',[]],
    [JOIN7,{...feedback,phone:'01000000001',name:'합성 검증'},'m',[]],
    ['/7/seoul/',{gender:'남성'},'m',[]],
    ['/7/seoul/',{gender:'남성'},'f',[]],
    [PAGE,{...feedback,sv_join:'7기',phone:'01000000001',name:'합성 검증'},'f',[{application_id:'synthetic-prior',gender:'남성'}]],
  ]) {
    const {response,writes,runs}=await submit(path,fields,g,prior);
    assert.equal(response.status,409,path);
    assert.equal((await response.json()).error,'cohort_closed');
    assert.equal(writes.length,0);
    assert.equal(runs.length,0);
  }
});

test('여성 7기·남성 8기·남녀 후기만은 그대로 접수, 후기 기수는 6기 유지', async () => {
  for (const [join,g] of [['7기','f'],['8기','m'],['후기만','m'],['후기만','f']]) {
    const {response,writes}=await submit(PAGE,{...feedback,sv_join:join,phone:'01000000001',name:'합성 검증'},g);
    assert.equal(response.status,200,join+g);
    const record=JSON.parse(writes.find(w=>w.key.startsWith('s:')).value);
    assert.deepEqual(record.survey.sv_cohorts,['6']);
    assert.equal(record.fields.gender,g==='m'?'남성':'여성');
    if(join==='후기만') assert.equal(record.phone_digits,'');
  }
});
