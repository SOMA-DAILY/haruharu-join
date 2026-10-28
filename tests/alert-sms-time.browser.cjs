// Entire UI + actual Pages API run against isolated in-memory SQLite/KV.
// No production HTTP calls, real participant rows, payments or SMS.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const out=process.env.ALERT_QA_OUTPUT||'/tmp/alert-sms-time-qa';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {onRequest}=await import('../functions/api/[[path]].js');
 const sql=new DatabaseSync(':memory:');
 for(const f of fs.readdirSync(path.join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'migrations',f),'utf8'));
 sql.exec(`INSERT INTO submissions(application_id,path,city,cohort,plan,submitted_ts,submitted_at,gender,birth_year,phone_digits,status,last_sms_sent_at,memo) VALUES
 ('qa-alert-unsent','/alert/seoul/','seoul','alert','prealert',1793000000000,'2026-10-26 10:00:00','여성','2004','01000000001','',NULL,''),
 ('qa-alert-sent','/alert/seoul/','seoul','alert','prealert',1793000001000,'2026-10-26 10:01:00','여성','2005','01000000002','문자 보냄','2026-10-26 12:55:17','이전 안내'),
 ('qa-alert-legacy','/alert/seoul/','seoul','alert','prealert',1793000002000,'2026-10-26 10:02:00','남성','2003','01000000003','문자 보냄',NULL,''),
 ('qa-regular-row','/8/seoul/','seoul','8','regular',1793000003000,'2026-10-26 10:03:00','여성','2004','01000000004','송금확인',NULL,'');`);
 const kv=new Map();
 const env={ADMIN_PASSWORD:'local-qa-only',ADMIN_SESSION_SECRET:'isolated-local-qa-secret',APPLY_KV:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v),delete:async k=>kv.delete(k)},DB:{
  prepare(query){return {bind(...args){
   const positions=[...query.matchAll(/\?(\d+)/g)].map(m=>Number(m[1])-1);
   const s=sql.prepare(query.replace(/\?\d+/g,'?')),params=positions.length?positions.map(i=>args[i]):args;
   return {first:async()=>s.get(...params)||null,all:async()=>({results:s.all(...params)}),run:async()=>({meta:{changes:Number(s.run(...params).changes)}})};
  },first:async()=>sql.prepare(query).get()||null,all:async()=>({results:sql.prepare(query).all()})};},
  async batch(xs){return Promise.all(xs.map(x=>x.all?x.all():x.run()));}
 }};
 const errors=[],checks=[];
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://'+req.headers.host);
   if(url.pathname.startsWith('/api/')){
    // Analytics are unrelated to this feature. Only applicant reads and mark
    // writes use the real API/SQLite; keep summary reads deterministic.
    const summaries={'/api/admin/analytics':{by_form:[],forms:[]},'/api/admin/links':{rows:[]},'/api/admin/ping':{last_submit:0,last_activity:0}};
    if(req.method==='GET'&&summaries[url.pathname]){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(summaries[url.pathname]));return;}
    let body='';for await(const b of req)body+=b;
    const response=await onRequest({request:new Request(url,{method:req.method,headers:req.headers,...(body?{body}:{})}),env,params:{path:url.pathname.slice(5).split('/')},waitUntil:p=>p.catch(e=>errors.push(e.message))});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   let file=path.resolve(root,'public','.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(path.join(root,'public')+path.sep))throw Error('Outside local assets');
   if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));
  }catch(e){errors.push(e.message);res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  for(const [label,engine] of [['chromium',chromium],['webkit',webkit]]){
   browser=await engine.launch({headless:true,...(label==='chromium'&&process.env.ALERT_QA_CHROME?{channel:'chrome'}:{}),
    ...(label==='webkit'&&process.env.ALERT_QA_WEBKIT_EXECUTABLE?{executablePath:process.env.ALERT_QA_WEBKIT_EXECUTABLE}:{})});
   for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900},locale:'ko-KR',timezoneId:'America/Los_Angeles',acceptDownloads:true});
    try{
     await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
     const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
     const response=await page.request.post(origin+'/api/admin/login',{data:{password:'local-qa-only'}});assert.equal(response.status(),200);
     await page.goto(origin+'/admin/');
     await page.locator('#nav [data-t=apps]').click();
     await page.locator('#aCohortTabs button[data-c=alert]').click();
     const row=id=>page.locator('#appRows tr[data-id="'+id+'"]');
     await row('qa-alert-sent').waitFor();
     assert.equal(await row('qa-alert-sent').locator('input.alert-sms-at').inputValue(),'2026-10-26T12:55');
     assert((await row('qa-alert-sent').locator('input.alert-sms-at').boundingBox()).width>=220,'Native date/time must fit without clipping');
     const before=sql.prepare('SELECT last_sms_sent_at FROM submissions WHERE application_id=?').get('qa-alert-sent').last_sms_sent_at;
     await row('qa-alert-sent').locator('td[data-label="전화번호"]').click();
     await page.locator('#dMemo').fill('가상 메모만 수정');await page.locator('#dSave').click();await page.locator('#drawer').waitFor({state:'hidden'});
     assert.equal(sql.prepare('SELECT last_sms_sent_at FROM submissions WHERE application_id=?').get('qa-alert-sent').last_sms_sent_at,before);
     const inlineSave=page.waitForResponse(r=>r.url().endsWith('/api/admin/mark'));
     await row('qa-alert-sent').locator('input.alert-sms-at').fill('2026-10-18T19:26');await row('qa-alert-sent').locator('input.alert-sms-at').press('Tab');
     await page.waitForFunction(()=>document.querySelector('tr[data-id="qa-alert-sent"] input.alert-sms-at')?.value==='2026-10-18T19:26');
     assert.equal((await inlineSave).status(),200);
     assert.equal(sql.prepare('SELECT last_sms_sent_at FROM submissions WHERE application_id=?').get('qa-alert-sent').last_sms_sent_at,'2026-10-18 19:26:00');
     await page.reload();await page.locator('#nav [data-t=apps]').click();await page.locator('#aCohortTabs button[data-c=alert]').click();
     assert.equal(await row('qa-alert-sent').locator('input.alert-sms-at').inputValue(),'2026-10-18T19:26');
     await row('qa-alert-unsent').locator('select.stsel').selectOption('문자 보냄');
     await row('qa-alert-unsent').locator('input.alert-sms-at').waitFor();assert(await row('qa-alert-unsent').locator('input.alert-sms-at').inputValue());
     await row('qa-alert-legacy').locator('td[data-label="전화번호"]').click();assert.equal(await page.locator('#dSmsAt').inputValue(),'');
     await page.locator('#dSmsAt').fill('2026-10-22T17:00');await page.locator('#dSave').click();await page.locator('#drawer').waitFor({state:'hidden'});
     assert.equal(sql.prepare('SELECT last_sms_sent_at FROM submissions WHERE application_id=?').get('qa-alert-legacy').last_sms_sent_at,'2026-10-22 17:00:00');
     const downloadPromise=page.waitForEvent('download');await page.locator('#csvBtn').click();const download=await downloadPromise;
     const csv=fs.readFileSync(await download.path(),'utf8');assert(csv.split('\n')[0].endsWith('최근문자발송일시'));assert(csv.includes('2026-10-18 19:26:00'));
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,label+'-'+width+'.png'),fullPage:true});
     await page.locator('#aCohortTabs button[data-c="8"]').click();await row('qa-regular-row').waitFor();assert.equal(await page.locator('input.alert-sms-at').count(),0);
     checks.push(label+' '+width+': KST display under LA timezone, memo preserves seconds, inline edit + reload, auto timestamp, detail edit, CSV, no overflow, non-alert unaffected');
     sql.prepare("UPDATE submissions SET status='',last_sms_sent_at=NULL WHERE application_id='qa-alert-unsent'").run();
     sql.prepare("UPDATE submissions SET last_sms_sent_at='2026-10-26 12:55:17' WHERE application_id='qa-alert-sent'").run();
     sql.prepare("UPDATE submissions SET last_sms_sent_at=NULL WHERE application_id='qa-alert-legacy'").run();
    }finally{await context.close();}
   }
   await browser.close();browser=null;
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,errors,production_requests_allowed:false,actual_sms_sent:false},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));sql.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
