import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { formOf, FORMS } from '../shared/forms.mjs';
import { feeFor, friendFee } from '../shared/friend-discount.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const buddy = { phone: '01010000001', buddy: '01010000002', buddy_room: '같은 방' };
test('8/9기 일반 신청만 남성 10,000 / 친구 8,000, 여성 및 재참여 요금 유지', () => {
  for (const path of ['/8/seoul/', '/9/seoul/']) {
    const f = formOf(path);
    assert.equal(feeFor(f, '남성').fee, 10000);
    assert.equal(feeFor(f, '여성').fee, 7900);
    assert.equal(friendFee(f, {...buddy, gender: '남성'}), 8000);
    assert.equal(friendFee(f, {...buddy, gender: '여성'}), 5900);
    assert.equal(friendFee(f, {...buddy, gender: '남성', buddy_room: '혼자'}), 0);
    assert.equal(friendFee(f, {...buddy, gender: '남성', buddy: buddy.phone}), 0);
    assert.equal(feeFor(f, '남성').pay, 'https://haruharu-pay.pages.dev/m/');
    assert.equal(feeFor(f, '남성').friendPay, 'https://haruharu-pay.pages.dev/mf/');
  }
  assert.equal(feeFor(formOf('/7/seoul/'), '남성').fee, 7900);
  assert.equal(feeFor(formOf('/8/seoul/rejoin/from-6/'), '남성').fee, 5900);
});

test('서버는 링크/클라이언트 할인 금액이 아닌 선택 성별로 8,000/5,900을 저장', async () => {
  const now=Date.now; Date.now=()=>Date.parse('2026-10-23T12:00:00+09:00');
  try { for (const path of ['/8/seoul/', '/9/seoul/']) for (const gender of ['남성','여성']) {
    const writes=[];
    const res=await onRequest({request:new Request('http://localhost/api/submit',{method:'POST',body:JSON.stringify({path,fields:{...buddy,gender,birth_year:'2003',school:'시험대',source:'인스타그램 광고',device:'아이폰',consent:'동의합니다',name:'가격검증'},hidden:{g:gender==='남성'?'f':'m',friend_fee:1},friend_fee:1})}), params:{path:['submit']},env:{APPLY_KV:{put:async(k,v)=>writes.push([k,v])}},waitUntil:()=>{}});
    assert.equal(res.status,200);
    assert.equal(JSON.parse(writes.find(([k])=>k.startsWith('s:'))[1]).friend_fee,gender==='남성'?8000:5900);
  } } finally { Date.now=now; }
});

test('관리 화면은 성별 참가비와 실제 저장된 친구 할인 금액을 표시', () => {
  const html=readFileSync(new URL('../public/admin/index.html',import.meta.url),'utf8');
  const start=html.indexOf('function regOf('), end=html.indexOf('// 사전알림 →',start);
  const ctx={REG:{FORMS},S:{apps:[]},isFest:()=>false,buddyOf:()=>null,esc:s=>s};
  vm.createContext(ctx); vm.runInContext(html.slice(start,end),ctx);
  assert.equal(ctx.feeOf({path:'/8/seoul/',gender:'남성',friend_fee:0}),'일반 10,000원');
  assert.equal(ctx.feeOf({path:'/9/seoul/',gender:'여성',friend_fee:0}),'일반 7,900원');
  assert.equal(ctx.feeOf({path:'/8/seoul/',gender:'남성',friend_fee:8000}),'친구 할인 8,000원');
  assert.equal(ctx.feeOf({path:'/8/seoul/',gender:'남성',friend_fee:5900}),'친구 할인 5,900원');
});
