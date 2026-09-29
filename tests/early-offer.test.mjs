import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlyOffer, EARLY_END } from '../shared/early-offer.mjs';
import { onRequest } from '../functions/api/[[path]].js';
const deadline=Date.parse(EARLY_END);
test('KST midnight boundary: discount stops exactly at October 1',()=>{
  assert.equal(new Date(deadline).toISOString(),'2026-09-30T15:00:00.000Z');
  assert.equal(earlyOffer(deadline-1).active,true);
  assert.equal(earlyOffer(deadline).active,false);
  assert.equal(earlyOffer(deadline+1).active,false);
});
test('server rejects expired early submissions without storing them; regular still works',async()=>{
 const original=Date.now; Date.now=()=>deadline;
 try {
  for(const city of ['seoul','gwangju']) {
   let writes=[];
   const env={APPLY_KV:{put:async(k,v)=>writes.push([k,v])}};
   const fields=Object.fromEntries(['gender','birth_year','school','source','device','phone','consent','name'].map(k=>[k,'test']));
   const send=async(plan)=>onRequest({request:new Request('http://localhost/api/submit',{method:'POST',body:JSON.stringify({fields,hidden:{city,plan},path:`/${city}/pre-4k9x/`})}),params:{path:['submit']},env});
   const rejected=await send('early');
   assert.equal(rejected.status,409); assert.equal((await rejected.json()).error,'early_expired'); assert.equal(writes.length,0);
   const accepted=await send('regular'); assert.equal(accepted.status,200);
   assert.equal(JSON.parse(writes[0][1]).hidden.plan,'regular');
  }
 } finally {Date.now=original;}
});
test('valid discount works until final millisecond and status never caches',async()=>{
 const original=Date.now;Date.now=()=>deadline-1;
 try{
 const status=await onRequest({request:new Request('http://localhost/api/early-offer'),params:{path:['early-offer']},env:{}});
 assert.equal(status.headers.get('cache-control'),'no-store');assert.equal((await status.json()).active,true);
 const fields=Object.fromEntries(['gender','birth_year','school','source','device','phone','consent','name'].map(k=>[k,'test']));
 const res=await onRequest({request:new Request('http://localhost/api/submit',{method:'POST',body:JSON.stringify({fields,hidden:{city:'seoul',plan:'early'}})}),params:{path:['submit']},env:{APPLY_KV:{put:async()=>{}}}});
 assert.equal(res.status,200);
 }finally{Date.now=original;}
});
test('pre-registration omits source/device even after expiry; regular forms still require both',async()=>{
 const fields=Object.fromEntries(['gender','birth_year','school','phone','consent','name'].map(k=>[k,'test']));
 for(const city of ['seoul','gwangju']){
  const send=path=>onRequest({request:new Request('http://localhost/api/submit',{method:'POST',body:JSON.stringify({fields,path,hidden:{city,plan:'regular'}})}),params:{path:['submit']},env:{APPLY_KV:{put:async()=>{}}}});
  assert.equal((await send(`/${city}/pre-4k9x/`)).status,200);
  const regular=await send(`/${city}/`);
  assert.equal(regular.status,400);
  assert.deepEqual((await regular.json()).miss,['source','device']);
 }
});
