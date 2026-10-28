import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { onRequest } from '../functions/api/[[path]].js';

async function fixture() {
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE submissions(application_id TEXT PRIMARY KEY,cohort TEXT,status TEXT DEFAULT '',memo TEXT DEFAULT '',status_updated_at TEXT,room TEXT DEFAULT '',buddy TEXT DEFAULT '',buddy_room TEXT DEFAULT '',last_sms_sent_at TEXT);
 INSERT INTO submissions(application_id,cohort,status,last_sms_sent_at) VALUES
 ('alert-test-0001','alert','',NULL),('alert-test-0002','alert','문자 보냄','2026-10-26 12:55:00'),
 ('alert-test-0003','alert','문자 보냄',NULL),('regular-test-0001','8','송금확인',NULL);`);
 const values=new Map();
 const env={ADMIN_PASSWORD:'local-test',ADMIN_SESSION_SECRET:'local-secret',APPLY_KV:{get:async k=>values.get(k)||null,put:async(k,v)=>values.set(k,v)},DB:{
  prepare(query){
   return {bind(...args){
    const indexes=[...query.matchAll(/\?(\d+)/g)].map(m=>Number(m[1])-1);
    const stmt=sql.prepare(query.replace(/\?\d+/g,'?')),params=indexes.length?indexes.map(i=>args[i]):args;
    return {first:async()=>stmt.get(...params)||null,all:async()=>({results:stmt.all(...params)}),run:async()=>({meta:{changes:Number(stmt.run(...params).changes)}})};
   }};
  }
 }};
 const login=await onRequest({request:new Request('http://localhost/api/admin/login',{method:'POST',body:JSON.stringify({password:'local-test'})}),params:{path:['admin','login']},env});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const row=id=>sql.prepare('SELECT * FROM submissions WHERE application_id=?').get(id);
 async function mark(body,auth=true){return onRequest({request:new Request('http://localhost/api/admin/mark',{method:'POST',headers:{origin:'http://localhost',...(auth?{cookie}:{})},body:JSON.stringify(body)}),params:{path:['admin','mark']},env});}
 return {sql,row,mark};
}
test('first sent status gets KST send time, independent from later admin edits',async()=>{
 const f=await fixture();
 let res=await f.mark({id:'alert-test-0001',status:'문자 보냄',memo:'test'});assert.equal(res.status,200);
 let data=await res.json(),r=f.row('alert-test-0001');assert.match(r.last_sms_sent_at,/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
 assert.equal(r.last_sms_sent_at,r.status_updated_at);assert.equal(data.last_sms_sent_at,r.last_sms_sent_at);
 const original=r.last_sms_sent_at;
 res=await f.mark({id:'alert-test-0001',status:'제외',memo:'edited'});assert.equal(res.status,200);assert.equal(f.row('alert-test-0001').last_sms_sent_at,original);
 res=await f.mark({id:'alert-test-0001',status:'문자 보냄',memo:'again'});assert.equal(res.status,200);assert.equal(f.row('alert-test-0001').last_sms_sent_at,original);
});
test('explicit past datetime uses KST without browser-timezone conversion; null clears',async()=>{
 const f=await fixture();let res=await f.mark({id:'alert-test-0002',status:'문자 보냄',last_sms_sent_at:'2026-10-18T19:26'});
 assert.equal(res.status,200);assert.equal((await res.json()).last_sms_sent_at,'2026-10-18 19:26:00');
 assert.equal(f.row('alert-test-0002').last_sms_sent_at,'2026-10-18 19:26:00');
 res=await f.mark({id:'alert-test-0002',status:'문자 보냄',last_sms_sent_at:null});assert.equal(res.status,200);assert.equal(f.row('alert-test-0002').last_sms_sent_at,null);
});
test('editing a legacy sent row with unknown date must not invent today as its send time',async()=>{
 const f=await fixture();assert.equal((await f.mark({id:'alert-test-0003',status:'문자 보냄',memo:'legacy'})).status,200);
 assert.equal(f.row('alert-test-0003').last_sms_sent_at,null);
});
test('invalid, impossible and future send timestamps are rejected without changing data',async()=>{
 const f=await fixture(),before={...f.row('alert-test-0002')};
 for(const bad of ['bad','2026-02-30T12:00','2025-02-29T10:00','2026-10-18T24:00','2026-10-18T10:60','2099-01-01T12:00',123,{},'2026-10-18T19:26Z']){
  const res=await f.mark({id:'alert-test-0002',status:'문자 보냄',last_sms_sent_at:bad});assert.equal(res.status,400,String(bad));assert.deepEqual({...f.row('alert-test-0002')},before);
 }
 assert.equal((await f.mark({id:'alert-test-0002',status:'문자 보냄',last_sms_sent_at:'2024-02-29T10:00'})).status,200);
});
test('only alert rows accept this field; normal marking and authentication still work',async()=>{
 const f=await fixture();assert.equal((await f.mark({id:'regular-test-0001',status:'확정',last_sms_sent_at:'2026-10-18T19:26'})).status,400);
 assert.equal(f.row('regular-test-0001').status,'송금확인');
 assert.equal((await f.mark({id:'regular-test-0001',status:'확정',room:'test-room'})).status,200);assert.equal(f.row('regular-test-0001').room,'test-room');
 assert.equal(f.row('regular-test-0001').last_sms_sent_at,null);
 assert.equal((await f.mark({id:'alert-test-0001',status:'문자 보냄'},false)).status,401);
 assert.equal((await f.mark({id:'missing-test-0001',status:'문자 보냄'})).status,404);
});
test('submission retry preserves send metadata, and core insert works before the new migration',()=>{
 const source=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8');
 const queryTemplate=source.match(/env\.DB\.prepare\(`(INSERT INTO submissions[\s\S]*?)`\)/)[1];
 for(const limited of [false,true])for(const migrated of [false,true]){
  const query=vm.runInNewContext('`'+queryTemplate+'`',{limited});
  const db=new DatabaseSync(':memory:');
  for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()){
   if(!migrated&&f==='0016_alert_sms_sent_at.sql')continue;
   db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
  }
  db.exec("INSERT INTO submissions(application_id,cohort,status,memo) VALUES('retry-test-0001','alert','문자 보냄','preserved')");
  if(migrated)db.exec("UPDATE submissions SET last_sms_sent_at='2026-10-26 12:55:17' WHERE application_id='retry-test-0001'");
  const args=['retry-test-0001','s:retry','/alert/seoul/','seoul','alert','local','local',1,'2026-10-28 10:00:00','test','01000000011','01000000011','여성','2004','','','iPhone','','','동의합니다','','prealert',''];
  if(limited)args.push('seoul-student');
  const params=[...query.matchAll(/\?(\d+)/g)].map(m=>args[Number(m[1])-1]);
  db.prepare(query.replace(/\?\d+/g,'?')).run(...params);
  const row=db.prepare("SELECT * FROM submissions WHERE application_id='retry-test-0001'").get();
  assert.equal(row.status,'문자 보냄');assert.equal(row.memo,'preserved');assert.equal(row.name,'test');
  if(migrated)assert.equal(row.last_sms_sent_at,'2026-10-26 12:55:17');
  db.close();
 }
});
