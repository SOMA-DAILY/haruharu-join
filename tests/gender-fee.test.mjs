import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { formOf, formStatus, entryTarget, FORMS } from '../shared/forms.mjs';
import { feeFor, friendFee } from '../shared/friend-discount.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const buddy = { phone: '01010000001', buddy: '01010000002', buddy_room: '같은 방' };
test('8~10기 일반 신청 남성 10,000 / 친구 8,000, 여성 및 재참여 요금 유지', () => {
  for (const path of ['/8/seoul/', '/9/seoul/', '/10/seoul/']) {
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

test('10기 사전알림 할인은 전용 링크에서만 열리고 동반 여부와 상관없이 같은 할인 금액을 적용한다', () => {
  const path = '/10/seoul/pre-offer/';
  const offer = formOf(path);
  const deadline = Date.parse('2026-11-22T18:00:00+09:00');
  assert.equal(offer.plan, 'discount');
  assert.ok(!offer.listed && !offer.entry);
  assert.equal(formStatus(path, deadline - 1).open, true);
  assert.equal(formStatus(path, deadline).open, false);
  assert.equal(entryTarget('/seoul/student/', deadline - 1), '/10/seoul/');
  for (const [gender, amount, pay] of [['여성', 5900, '/b/'], ['남성', 8000, '/mf/']]) {
    const price = feeFor(offer, gender);
    assert.equal(price.fee, amount);
    assert.equal(new URL(price.pay).pathname, pay);
    assert.equal(friendFee(offer, { ...buddy, gender }), 0);
  }
});

test('서버는 링크/클라이언트 할인 금액이 아닌 선택 성별로 8,000/5,900을 저장', async () => {
  const now=Date.now; Date.now=()=>Date.parse('2026-10-23T12:00:00+09:00');
  try { for (const path of ['/8/seoul/', '/9/seoul/', '/10/seoul/']) for (const gender of ['남성','여성']) {
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
  const offer = {path:'/10/seoul/pre-offer/',gender:'여성',plan:'discount'};
  assert.equal(ctx.feeOf(offer),'할인 5,900원');
  assert.equal(ctx.feeOf({...offer,gender:'남성'}),'할인 8,000원');
  assert.equal(ctx.feeOf({...offer,path:'/unknown/'}),'참가비 확인 필요');
  assert.equal(ctx.feeOf({path:'/8/seoul/',gender:'남성',friend_fee:0}),'일반 10,000원');
  assert.equal(ctx.feeOf({path:'/9/seoul/',gender:'여성',friend_fee:0}),'일반 7,900원');
  assert.equal(ctx.feeOf({path:'/8/seoul/',gender:'남성',friend_fee:8000}),'친구 할인 8,000원');
  assert.equal(ctx.feeOf({path:'/8/seoul/',gender:'남성',friend_fee:5900}),'친구 할인 5,900원');
});

test('10기 사전알림 할인폼은 정식 폼의 소개, 신청 단계, 모든 문항과 완료 화면을 사용한다', () => {
  const page = (path) => readFileSync(new URL('../public/10/seoul/' + path + 'index.html', import.meta.url), 'utf8');
  const regular = page('');
  const offer = page('pre-offer/');
  const controls = /\bdata-(?:sec|page|name|cta)="[^"]+"/g;
  assert.deepEqual(offer.match(controls), regular.match(controls));
  assert.ok(offer.includes('<i data-n="400">400</i>'));
  assert.ok(offer.includes('남성 8,000원 / 여성 5,900원'));
  assert.ok(!offer.includes('둘 다 2,000원 할인</span>'));
});
