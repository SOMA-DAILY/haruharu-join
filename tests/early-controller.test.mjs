import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../src/early-offer.js',import.meta.url),'utf8');
async function setup(response,failed=false){
 let redirects=0; let clock=0; const ticks=[],alerts=[];
 const elements=Object.fromEntries(['early-banner','pay','submit','offer-fee','offer-caption','schedule','f','offer-clock','offer-message','offer-original'].map(id=>[id,{textContent:'',dataset:{},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(){}}]));
 elements['offer-clock'].querySelectorAll=()=>Array.from({length:6},()=>({dataset:{}}));
 elements.schedule.textContent='참가비: 4,900원';
 elements.pay.previousElementSibling={textContent:'사전 알림을 신청해 주신 분은 4,900원에 참여할 수 있어요. 입금 금액 : 4,900원'};
 const hidden={plan:'early'};
 const context={window:{addEventListener(){}},document:{getElementById:id=>elements[id],addEventListener(){},visibilityState:'visible'},performance:{now:()=>clock},fetch:async()=>{if(failed)throw Error();return {ok:true,json:async()=>response};},setInterval:fn=>ticks.push(fn),setTimeout:()=>1,clearTimeout(){},AbortController,alert:m=>alerts.push(m)};
 vm.runInNewContext(code,context);
 const control=context.window.setupEarlyOffer(hidden,()=>redirects++);
 await new Promise(r=>setImmediate(r));
 return {elements,hidden,control,alerts,get redirects(){return redirects;},tick(ms){clock=ms;ticks[0]();}};
}
test('open form redirects once at deadline and blocks payment and submission',async()=>{
 const ui=await setup({active:true,serverNow:1000,endsAt:2000});
 assert.equal(ui.elements.pay.href,'https://haruharu-pay.pages.dev/e/');
 ui.tick(1000);ui.tick(2000);
 assert.equal(ui.redirects,1);assert.equal(ui.elements.pay.href,undefined);
 assert.equal(ui.control.canSubmit(),false);
});
test('expired first visit redirects immediately',async()=>{
 const ui=await setup({active:false,serverNow:2000,endsAt:2000});
 assert.equal(ui.redirects,1);assert.equal(ui.control.canSubmit(),false);
});
test('in-flight submission waits for response before redirecting',async()=>{
 const ui=await setup({active:true,serverNow:1000,endsAt:2000});
 ui.elements.f.dataset.submitting='true';ui.tick(1000);assert.equal(ui.redirects,0);
 ui.elements.f.dataset.submitting='false';ui.control.update({active:false,serverNow:2000,endsAt:2000});
 assert.equal(ui.redirects,1);
});
test('failed status check blocks payment and submission',async()=>{
 const ui=await setup(null,true);
 assert.equal(ui.elements.pay.href,undefined);assert.equal(ui.elements.submit.disabled,true);
 assert.equal(ui.control.canSubmit(),false);
});
test('offer refresh cannot re-enable an in-flight submission',async()=>{
 const ui=await setup({active:true,serverNow:1000,endsAt:2000});
 ui.elements.f.dataset.submitting='true';
 ui.control.update({active:true,serverNow:1100,endsAt:2000});
 assert.equal(ui.elements.submit.disabled,true);
});
