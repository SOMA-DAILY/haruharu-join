// Local synthetic QA only. No real payments, recipients, or production writes.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs');
const origin = process.env.REVIEW_QA_ORIGIN || 'http://127.0.0.1:8923';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error('Local QA only');
const out = process.env.REVIEW_QA_OUTPUT || '/tmp/haruharu-returning-qa';
const path = '/rejoin/seoul/returning/?src=msg-seoul-returning-f&g=f';
const option = c => `.q[data-name=sv_join] .opt[data-path="/${c}/seoul/rejoin/returning/"]`;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const engine = process.env.REVIEW_QA_BROWSER === 'webkit' ? webkit : chromium;
  const label = engine === webkit ? 'webkit' : 'chromium';
  const browser = await engine.launch({ headless: true }), checks = [], errors = [];
  try {
    for (const width of [390, 360]) for (const cohort of ['8', '9']) for (const wish of ['', '굿']) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ko-KR' });
      try {
        await context.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + path);
        await page.getByRole('heading', { name: '서울 8·9기 재참여 신청' }).waitFor();
        assert.equal(await page.locator('[name=sv_wish]').getAttribute('placeholder'), null);
        assert.match(await page.locator('.sv-lead').innerText(), /기존 참가자는 2,000원 할인된 5,900원으로 신청하실 수 있습니다\./);
        assert.equal(await page.locator('#submit').innerText(), '참여할 일정을 선택해 주세요.');
        await page.waitForFunction(() => document.querySelector('[data-required-join]') && document.querySelector('#submit').disabled);
        assert.equal(await page.locator('[name=sv_review]').count(), 0);
        assert.equal(await page.locator('[name=sv_cohorts]').count(), 0);
        assert.equal(await page.locator('.q[data-name=phone]').isVisible(), false);
        assert.equal(await page.locator('[name=sv_wish]').isVisible(), true);
        await page.locator(option(cohort)).scrollIntoViewIfNeeded();
        const beforePickScroll = await page.evaluate(() => window.scrollY);
        await page.locator(option(cohort)).click();
        await page.waitForTimeout(150);
        assert(Math.abs(await page.evaluate(() => window.scrollY) - beforePickScroll) < 2, 'New application choice must not skip the optional wish with automatic scrolling');
        assert.equal(await page.locator('#submit').isEnabled(), true);
        assert.equal(await page.locator('#submit').innerText(), '재참여 신청하기');
        assert.equal(await page.locator('[name=sv_join]:checked').inputValue(), cohort + '기');
        assert.equal(await page.locator('.q[data-name=phone]').isVisible(), true);
        assert.match(await page.locator('.q[data-name=name]').innerText(), /5,900원/);
        await page.locator(option(cohort)).click();
        assert.equal(await page.locator('#submit').isEnabled(), false);
        await page.locator(option(cohort)).click();
        await page.locator('[name=sv_wish]').fill(wish);
        await page.locator('[name=phone]').fill('01000000001');
        await page.locator('[name=name]').fill('로컬 재참여 검사');
        assert(await page.locator('#f').evaluate(f => f.scrollWidth <= document.documentElement.clientWidth + 1));
        await page.screenshot({ path: `${out}/${label}-${width}-${cohort}-${wish ? 'wish' : 'blank'}.png`, fullPage: true });
        const received = page.waitForResponse(r => r.url().endsWith('/api/submit') && r.request().method() === 'POST');
        await page.locator('#submit').click();
        const response = await received;
        assert.equal(response.status(), 200);
        const payload = response.request().postDataJSON();
        assert.equal(payload.path, '/rejoin/seoul/returning/');
        assert.equal(payload.fields.sv_join, cohort + '기');
        assert.equal(payload.fields.sv_review, undefined);
        await page.getByRole('heading', { name: '신청이 접수됐어요 💌' }).waitFor();
        assert(!/후기/.test(await page.locator('.page[data-page=done]').innerText()));
        checks.push({ width, cohort, optionalWish: wish || '(blank)', submittedLocal: true });
      } finally { await context.close(); }
    }
    for (const closed of [['8'], ['8', '9']]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        await context.route('**/*', route => {
          const u = new URL(route.request().url());
          if (u.origin !== origin) return route.abort();
          if (u.pathname === '/api/cohort' && closed.some(c => u.searchParams.get('path')?.startsWith(`/${c}/`)))
            return route.fulfill({ json: { open: false } });
          return route.continue();
        });
        const page = await context.newPage(); await page.goto(origin + path);
        await page.waitForFunction(n => [...document.querySelectorAll('.sv-join .opt[data-path]')].filter(o => !o.hidden).length === n, 2 - closed.length);
        assert.equal(await page.locator('#submit').isEnabled(), false);
        if (closed.length === 2) assert.equal(await page.locator('.sv-join-empty').isVisible(), true);
        else { await page.locator(option('9')).click(); assert.equal(await page.locator('#submit').isEnabled(), true); }
        checks.push({ closed, noAnonymousSubmission: true });
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/result-${label}.json`, JSON.stringify({ label, checks, errors, productionWrites: false }, null, 2));
    console.log(`${label}: ${checks.length} checks PASS, no JS errors`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
