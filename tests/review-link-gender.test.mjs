import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

const pages = ['/rejoin/seoul/', '/rejoin/6/seoul/'];
const fields = { sv_join: '후기만', sv_cohorts: ['6'], sv_review: '미션으로 자연스럽게 대화를 나눌 수 있어서 좋았어요.', sv_wish: '다음에는 다양한 질문이 더 많이 있었으면 좋겠어요.' };
async function request(path, g, extra = {}, route = 'submit', prior = []) {
  const writes = [], runs = [], old = Date.now;
  Date.now = () => Date.parse('2026-10-22T14:00:00+09:00');
  const env = {
    APPLY_KV: { put: async (key, value) => writes.push([key, value]) },
    DB: { prepare: sql => ({ bind: (...args) => ({ sql, args, all: async () => ({ results: /FROM submissions WHERE phone_digits/.test(sql) ? prior : [] }), run: async () => { runs.push({sql,args}); return {}; } }) }), batch: async stmts => { runs.push(...stmts); return []; } },
  };
  try {
    const response = await onRequest({ request: new Request('http://localhost/api/'+route, { method: 'POST', body: JSON.stringify({ path, sid: '00000000-0000-4000-8000-000000000099', fields: route === 'submit' ? {...fields,...extra} : extra, hidden: {g}, landed: true }) }), params: {path:[route]}, env, waitUntil: () => {} });
    const saved = writes.find(([key]) => key.startsWith('s:'));
    return {response, record: saved && JSON.parse(saved[1]), runs};
  } finally { Date.now = old; }
}

test('기존/6기 후기만 제출: 남녀 링크 성별이 KV·D1에 남고 신원 정보는 받지 않음', async () => {
  for (const path of pages) for (const [g,gender] of [['f','여성'],['m','남성']]) {
    const {response,record,runs} = await request(path,g,{gender:gender==='여성'?'남성':'여성',phone:'01000000001',name:'합성검증'});
    assert.equal(response.status,200);assert.equal(record.fields.gender,gender);assert.equal(record.hidden.g,g);
    assert.equal(record.phone_digits,'');assert.equal(record.fields.phone,undefined);assert.equal(record.fields.name,undefined);
    assert.equal(runs.find(r=>/INSERT OR REPLACE INTO submissions/.test(r.sql)).args[12],gender);
  }
});

test('성별 없는/잘못된 링크는 후기 성별 미확인, 임의 입력 성별도 쓰지 않음', async () => {
  for (const g of [undefined,'','x','female','F','<script>']) {
    const {response,record} = await request(pages[1],g,{gender:'여성'});
    assert.equal(response.status,200);assert.equal(record.fields.gender,undefined);assert.equal(record.hidden.g,undefined);
  }
});

test('재신청은 기존 프로필 성별 우선, 이전 성별이 없으면 링크 성별로 기록', async () => {
  for (const path of pages) {
    const extra={sv_join:'7기',phone:'01000000001',name:'합성검증'};
    const prior=await request(path,'m',extra,'submit',[{application_id:'prior',gender:'여성'}]);
    assert.equal(prior.response.status,200);assert.equal(prior.record.fields.gender,'여성');assert.equal(prior.record.hidden.g,'m');
    const fallback=await request(path,'m',extra);
    assert.equal(fallback.response.status,200);assert.equal(fallback.record.fields.gender,'남성');
  }
});

test('남녀 후기 링크 방문은 성별을 보관하지만 자동 성별만으로 입력 시작을 올리지 않음', async () => {
  for (const path of pages) for (const [g,gender] of [['f','여성'],['m','남성']]) {
    const {response,runs}=await request(path,g,{},'partial');
    assert.equal(response.status,200);
    const row=runs.find(r=>/INSERT INTO sessions/.test(r.sql));
    assert.equal(row.args[20],0);assert.equal(row.args[21],null);assert.equal(row.args[25],0);
    assert.deepEqual(JSON.parse(row.args[24]),{gender});
    const entered=await request(path,g,{phone:'01000000001'},'partial');
    const e=entered.runs.find(r=>/INSERT INTO sessions/.test(r.sql));assert.equal(e.args[20],1);assert.equal(e.args[25],1);
  }
});

test('양쪽 후기 화면이 링크 g를 방문 및 제출 payload에 전달', () => {
  for (const path of pages) assert.match(readFileSync(new URL('../public'+path+'index.html',import.meta.url),'utf8'),/var HID=\['g','src',/);
});

test('일반 신청폼의 성별 직접 응답은 후기 링크 성별 처리의 영향을 받지 않음', async () => {
  const {response,runs}=await request('/7/seoul/','f',{gender:'남성'},'partial');
  assert.equal(response.status,200);
  const row=runs.find(r=>/INSERT INTO sessions/.test(r.sql));
  assert.equal(JSON.parse(row.args[24]).gender,'남성');assert.equal(row.args[20],1);assert.equal(row.args[25],1);
});
