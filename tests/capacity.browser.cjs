// Runs only against an isolated local Pages/D1/KV instance. External requests (including payments/analytics) are blocked.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const origin = process.env.CAPACITY_QA_ORIGIN || 'http://localhost:8948';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw Error('Local QA only');
const out = process.env.CAPACITY_QA_OUTPUT || '/tmp/capacity-qa';
fs.mkdirSync(out, { recursive: true });
const engineName = process.env.CAPACITY_QA_BROWSER || 'chromium';
const engine = engineName === 'webkit' ? webkit : chromium;
const checks = [], errors = [];
(async () => {
 const browser = await engine.launch({ headless: true });
 try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(origin + '/admin/');
  await page.locator('#pw').fill('local-capacity'); await page.getByRole('button', { name: '들어가기', exact: true }).click();
  await page.locator('#capacityRows form[data-cohort="8"]').waitFor();
  const editor = page.locator('#capacityRows form[data-cohort="8"]');
  await editor.locator('[name=m]').fill('1'); await editor.locator('[name=f]').fill('2');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/admin/capacities') && r.request().method() === 'POST');
  await editor.getByRole('button', { name: '정원 저장' }).click();
  assert.equal((await saved).status(), 200);
  await page.waitForFunction(() => {
   const field = document.querySelector('#capacityRows [name=m]');
   return field?.value === '1' && field.closest('label').querySelector('.capacity-count')?.getAttribute('aria-label') === '현재 1명' && field.closest('label').querySelector('.capacity-state')?.textContent === '마감';
  });
  await page.locator('#capacityCard').screenshot({ path: `${out}/${engineName}-admin-desktop.png` });
  for (const width of [390, 360]) {
   await page.setViewportSize({ width, height: 844 });
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.locator('#capacityCard').screenshot({ path: `${out}/${engineName}-admin-${width}.png` });
  }
  checks.push('관리자 정원 입력/저장, 저장 뒤 인원/정원 마감 표시, 1280/390/360px 줄바꿈');
  const admin = context.request;
  async function set(c, m, f = 2) {
   const response = await admin.post(origin + '/api/admin/capacities', { headers: { origin }, data: { cohort: c, track: 'seoul-student', male_limit: m, female_limit: f } });
   assert.equal(response.status(), 200);
  }
  async function refresh() { await page.evaluate(() => window.hhCapacityRefresh()); }
  const card = c => page.locator(`#pick [data-cohort="${c}"]`);
  await set('9', 2);
  await context.addCookies([{ name: 'hh_g', value: 'm', url: origin }]);
  for (const width of [390, 360]) {
   await page.setViewportSize({ width, height: 844 });
   await page.goto(origin + '/admin/');
   await page.evaluate(() => localStorage.removeItem('hh_draft:/8/seoul/'));
   await page.goto(origin + '/8/seoul/?g=m');
   await page.waitForFunction(() => document.querySelector('#pick [data-cohort="8"] .pk-badge').textContent === '남성 마감 여성 모집 중');
   assert.deepEqual(await card('9').locator('.pk-gender').allTextContents(), ['남성 모집 중', '여성 모집 중']);
   assert.equal(await page.locator('input[name=gender]:checked').count(), 0);
   assert.equal(await card('8').isDisabled(), false);
   assert.equal(await card('8').getAttribute('aria-checked'), 'true');
   await page.locator('#pick').screenshot({ path: `${out}/${engineName}-unselected-${width}.png` });
   await page.locator('.q[data-name="gender"] label').filter({ has: page.locator('input[value="남성"]') }).click();
   await page.waitForFunction(() => document.querySelector('#pick [data-cohort="8"]').disabled);
   assert.deepEqual(await card('8').locator('.pk-gender').allTextContents(), ['남성 마감', '여성 모집 중']);
   assert.equal(await card('9').getAttribute('aria-checked'), 'true');
   await page.locator('#pick').screenshot({ path: `${out}/${engineName}-male-full-${width}.png` });
   await page.locator('.q[data-name="gender"] label').filter({ has: page.locator('input[value="여성"]') }).click();
   await page.waitForFunction(() => !document.querySelector('#pick [data-cohort="8"]').disabled);
   await card('8').click(); assert.equal(await card('8').getAttribute('aria-checked'), 'true');
   await page.locator('#pick').screenshot({ path: `${out}/${engineName}-female-open-${width}.png` });
   await page.locator('.q[data-name="gender"] label').filter({ has: page.locator('input[value="남성"]') }).click();
   await page.waitForFunction(() => document.querySelector('#pick [data-cohort="8"]').disabled);
   assert.equal(await card('9').getAttribute('aria-checked'), 'true');
  }
  await page.goto(origin + '/8/seoul/?g=f');
  await page.waitForFunction(() => document.querySelector('#pick [data-cohort="8"]').disabled);
  assert.equal(await page.locator('input[name=gender]:checked').inputValue(), '남성');
  await page.goto(origin + '/admin/');
  await page.evaluate(() => localStorage.removeItem('hh_draft:/8/seoul/'));
  await page.goto(origin + '/8/seoul/');
  await page.waitForFunction(() => document.querySelector('#pick [data-cohort="8"] .pk-badge').textContent === '남성 마감 여성 모집 중');
  assert.equal(await card('8').getAttribute('aria-checked'), 'true');
  await page.locator('.q[data-name="gender"] label').filter({ has: page.locator('input[value="남성"]') }).click();
  await page.waitForFunction(() => document.querySelector('#pick [data-cohort="8"]').disabled);
  checks.push('성별 미선택은 광고 링크/쿠키 대신 전체 모집 여부 표시, 실제/복원된 선택은 해당 성별 마감 적용');
  checks.push('남성 마감/여성 접수, 성별 변경에 따른 카드 갱신, 다른 기수 선택, 390/360px');
  await set('9', 0); await refresh();
  assert(await card('8').isDisabled()); assert(await card('9').isDisabled());
  assert(await page.locator('#submit').isDisabled());
  assert.equal(await page.locator('#pay').getAttribute('aria-disabled'), 'true');
  assert.equal(await page.locator('#acctCopy').getAttribute('aria-disabled'), 'true');
  await page.locator('#pick').screenshot({ path: `${out}/${engineName}-both-full.png` });
  await set('8', 2); await refresh();
  assert.equal(await card('8').isDisabled(), false); assert.equal(await card('8').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#submit').isDisabled(), false);
  checks.push('두 기수 모두 마감 시 신청/송금 차단, 증원 시 같은 화면에서 접수 재개');
  await set('8', 1); await set('9', 2);
  await page.goto(origin + '/rejoin/seoul/returning/?g=m');
  await page.waitForFunction(() => document.querySelector('.opt[data-path="/8/seoul/rejoin/returning/"]').hidden);
  assert.equal(await page.locator('.opt[data-path="/9/seoul/rejoin/returning/"]').isVisible(), true);
  await page.locator('.opt[data-path="/9/seoul/rejoin/returning/"]').click();
  assert.equal(await page.locator('input[name=sv_join]:checked').inputValue(), '9기');
  await set('8', 2); await refresh();
  assert.equal(await page.locator('.opt[data-path="/8/seoul/rejoin/returning/"]').isVisible(), true);
  checks.push('재참여 폼에도 성별 정원 적용, 증원 후 선택지 복구');
  // Submit against the real local API after the last seat disappears while a form is being completed.
  await set('8', 1, 2); await set('9', 2, 2);
  await page.goto(origin + '/8/seoul/?g=f');
  await page.getByRole('button', { name: '소개팅 신청하기 💌', exact: true }).first().click();
  await page.locator('.q[data-name="gender"] label').filter({ has: page.locator('input[value="여성"]') }).click();
  await card('8').click();
  await page.locator('input[name=birth_year]').fill('2003'); await page.locator('input[name=school]').fill('가상 로컬대');
  await page.locator('label').filter({ has: page.locator('input[name=source][value="인스타그램 광고"]') }).click();
  await page.locator('label').filter({ has: page.locator('input[name=device][value="iPhone"]') }).click();
  await page.locator('button[data-next]:visible').click();
  await page.locator('input[name=phone]').fill('01000000004');
  await page.locator('label').filter({ has: page.locator('input[name=consent]') }).click();
  await page.locator('button[data-next]:visible').click();
  await page.locator('input[name=name]').fill('가상 경합 확인');
  await set('8', 1, 0);
  const rejected = page.waitForResponse(r => r.url().endsWith('/api/submit'));
  await page.locator('#submit').click(); assert.equal((await rejected).status(), 409);
  await page.waitForFunction(() => document.querySelector('#pick [data-cohort="8"]').disabled);
  assert.equal(await page.locator('input[name=phone]').inputValue(), '01000000004');
  assert.equal(await page.locator('input[name=name]').inputValue(), '가상 경합 확인');
  assert.equal(await card('9').getAttribute('aria-checked'), 'true');
  const accepted = page.waitForResponse(r => r.url().endsWith('/api/submit'));
  await page.locator('#submit').click(); const receipt = await accepted; assert.equal(receipt.status(), 200);
  const acceptedId = (await receipt.json()).application_id;
  await page.getByRole('heading', { name: '신청이 접수됐어요 💌' }).waitFor();
  const removed = await admin.delete(origin + '/api/admin/applicants', { headers: { origin }, data: { id: acceptedId, confirm: acceptedId } });
  assert.equal(removed.status(), 200);
  checks.push('작성 중 마지막 자리 소진 → 서버 거절 → 입력 보존 → 다른 기수에 실제 접수 완료');
  await set('8', 1); await set('9', 2);
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${out}/${engineName}-result.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ engine: engineName, checks, errors }, null, 2));
  await context.close();
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
