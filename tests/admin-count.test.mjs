import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const path of ['src/admin.html', 'public/admin/index.html']) {
 test(`${path}: only pending and payment-confirmed applications contribute to every summary`, () => {
  const html=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const nodes={};
  const today='2026-10-27',yesterday='2026-10-26';
  const apps=['','송금확인','송금확인 안됨','결제 요청함','연락함','확정','보류','취소','unknown'].map((status,i)=>({status,gender:i===0?'여성':'남성',submitted_at:i===1?yesterday:today,src:i>1?'excluded':'included',cohort:'8'}));
  const ctx={S:{cohort:'8',apps,today:null},$:id=>nodes[id]??=( {classList:{remove(){}}}),setAppLabels(){},inTab:r=>r.cohort==='8',dayStart:off=>Date.parse(today+'T00:00:00+09:00')+off*86400000,cohortOf:r=>r.cohort,trackOf:()=> 'seoul-student',trackList:()=>['seoul-student'],TRACK_KO:{'seoul-student':'서울 학생'},cohortKo:c=>c+'기',esc:String,pct:(a,b)=>a/b*100+'%',srcCell:String};
  vm.createContext(ctx);
  vm.runInContext(html.match(/function counted\(r\)\{[^\n]+/)[0]+'\n'+html.match(/function renderAppSummary\(\)\{[\s\S]*?\n\}/)[0],ctx);
  ctx.renderAppSummary();
  assert.equal(nodes.aTotal.textContent,2);
  assert.equal(nodes.aToday.textContent,1);
  assert.equal(nodes.aTodayS.textContent,'어제 1');
  assert.equal(nodes.aGen.textContent,'1 : 1');
  assert.equal(nodes.aDone.textContent,'1 / 2');
  assert.equal(nodes.aDoneS.textContent,'송금확인 1 / 미처리 1');
  assert.match(nodes.aTotalS.innerHTML,/서울 학생 2/);
  assert.match(nodes.aTotalS.innerHTML,/7명 제외/);
  assert.doesNotMatch(nodes.aBySrc.innerHTML,/excluded/);
  assert.match(nodes.aBySrc.innerHTML,/<b>2<\/b>/);
  apps[1].status='확정';ctx.renderAppSummary();
  assert.equal(nodes.aTotal.textContent,1);assert.equal(nodes.aDone.textContent,'0 / 1');
  apps[0].status='취소';ctx.renderAppSummary();
  assert.equal(nodes.aTotal.textContent,0);assert.equal(nodes.aGenS.textContent,'');assert.equal(nodes.aDone.textContent,'0 / 0');
 });
}
