import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].js';
async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE submissions(application_id TEXT PRIMARY KEY, kv_key TEXT);CREATE TABLE sessions(application_id TEXT, fields TEXT);');
 const ids=['delete-test-0001','delete-test-0002'];const values=new Map();
 for(const id of ids){sql.prepare('INSERT INTO submissions VALUES (?,?)').run(id,'s:'+id);sql.prepare('INSERT INTO sessions VALUES (?,?)').run(id,'private');values.set('s:'+id,{application_id:id});values.set('m:'+id,{memo:'private'});}
 let kvFail=false,dbFail=false;
 const env={ADMIN_PASSWORD:'local-test',ADMIN_SESSION_SECRET:'local-secret',APPLY_KV:{get:async(k,type)=>values.get(k)||null,put:async(k,v)=>values.set(k,v),delete:async k=>{if(kvFail)throw Error();values.delete(k);}},DB:{prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query.replace(/\?\d+/g,'?')).get(...args),run:()=>sql.prepare(query.replace(/\?\d+/g,'?')).run(...args)}}};},async batch(statements){if(dbFail)throw Error();sql.exec('BEGIN');try{for(const s of statements)s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}}};
 const login=await onRequest({request:new Request('http://localhost/api/admin/login',{method:'POST',body:JSON.stringify({password:'local-test'})}),params:{path:['admin','login']},env});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 async function remove(body={id:ids[0],confirm:ids[0]},auth=true,origin='http://localhost'){
  return onRequest({request:new Request('http://localhost/api/admin/applicants',{method:'DELETE',headers:{origin,...(auth?{cookie}:{})},body:JSON.stringify(body)}),params:{path:['admin','applicants']},env});
 }
 return {sql,values,ids,remove,setKVFailure(v){kvFail=v},setDBFailure(v){dbFail=v}};
}
test('deletes exactly one original, memo, submission and linked sessions',async()=>{
 const f=await fixture();assert.equal((await f.remove()).status,200);
 assert.deepEqual(f.sql.prepare('SELECT application_id FROM submissions').all().map(x=>x.application_id),[f.ids[1]]);
 assert.deepEqual(f.sql.prepare('SELECT application_id FROM sessions').all().map(x=>x.application_id),[f.ids[1]]);
 assert.ok(!f.values.has('s:'+f.ids[0]));assert.ok(!f.values.has('m:'+f.ids[0]));assert.ok(f.values.has('s:'+f.ids[1]));
 assert.equal((await f.remove()).status,404);
});
test('requires admin login, same origin and confirmation of a single ID',async()=>{
 const f=await fixture();assert.equal((await f.remove(undefined,false)).status,401);
 assert.equal((await f.remove(undefined,true,'https://attacker.example')).status,403);
 for(const body of [{id:f.ids[0]},{id:f.ids[0],confirm:f.ids[1]},{all:true}])assert.equal((await f.remove(body)).status,400);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n,2);
});
test('KV failure preserves the list and allows retry',async()=>{
 const f=await fixture();f.setKVFailure(true);assert.equal((await f.remove()).status,500);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n,2);
 f.setKVFailure(false);assert.equal((await f.remove()).status,200);
});
test('D1 failure after KV cleanup can be retried',async()=>{
 const f=await fixture();f.setDBFailure(true);assert.equal((await f.remove()).status,500);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n,2);
 f.setDBFailure(false);assert.equal((await f.remove()).status,200);
});
test('mismatched original cannot delete another applicant',async()=>{
 const f=await fixture();f.values.set('s:'+f.ids[0],{application_id:f.ids[1]});assert.equal((await f.remove()).status,409);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM submissions').get().n,2);
});
