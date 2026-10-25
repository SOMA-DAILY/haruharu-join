// Local UI QA only: production writes, payment navigation, and analytics are blocked.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const origin = process.env.REVIEW_QA_ORIGIN || 'http://127.0.0.1:8919';
if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw Error('Local QA only');
const out = process.env.REVIEW_QA_OUTPUT || '/tmp/haruharu-review7-qa';
fs.mkdirSync(out, { recursive: true });
const path = '/rejoin/7/seoul/?src=rejoin-7-msg&g=f';
const join = c => `.q[data-name=sv_join] .opt[data-path="/${c}/seoul/rejoin/from-7/"]`;

(async () => {
  const engine = process.env.REVIEW_QA_BROWSER === 'webkit' ? webkit : chromium;
  const browser = await engine.launch({ headless: true });
  const checks = [], errors = [], submissions = [];
  try {
    for (const width of [390, 360]) {
      for (const choice of ['후기만', '8기', '9기']) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ko-KR' });
        try {
          await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
          const page = await context.newPage();
          page.setDefaultTimeout(12000);
          page.on('pageerror', error => errors.push(error.message));
          const response = await page.goto(origin + path);
          assert.equal(response.status(), 200);
          await page.getByRole('heading', { name: '7기, 어땠어요?' }).waitFor();
          await page.waitForFunction(() => {
            const options = [...document.querySelectorAll('.q[data-name=sv_join] .opt[data-path]')].filter(e => !e.hidden);
            return JSON.stringify(options.map(e => e.querySelector('input').value)) === JSON.stringify(['8기', '9기']);
          });
          assert.equal(await page.locator('input[name=sv_join]:checked').inputValue(), '후기만');
          assert.equal(await page.locator('.q[data-name=phone]').isVisible(), false);
          const optionsText = await page.locator('.sv-cos').innerText();
          assert.match(optionsText, /10\/30\(금\) ~ 11\/1\(일\)/);
          assert.match(optionsText, /11\/6\(금\) ~ 11\/8\(일\)/);
          if (choice !== '후기만') {
            const cohort = choice[0];
            await page.locator(join(cohort)).click();
            assert.equal(await page.locator('.q[data-name=phone]').isVisible(), true);
            assert.equal(await page.locator('input[name=sv_join]:checked').inputValue(), choice);
            assert.match(await page.locator('.q[data-name=name]').innerText(), /5,900원/);
            assert.equal(await page.locator('#pay').getAttribute('href'), 'https://haruharu-pay.pages.dev/b/');
            assert(!/3,900원/.test(await page.locator('#f').innerText()));
            const friend = page.locator('label.opt').filter({ has: page.locator('input[name=buddy_room][value="같은 방"]') });
            await friend.click();
            await page.locator('input[name=buddy]').fill('01000000002');
            assert.match(await page.locator('.q[data-name=name]').innerText(), /5,900원/);
            // Deselecting must clear the optional rejoin fields and remain usable anonymously.
            await page.locator(join(cohort)).click();
            assert.equal(await page.locator('input[name=sv_join]:checked').inputValue(), '후기만');
            assert.equal(await page.locator('.q[data-name=phone]').isVisible(), false);
            await page.locator(join(cohort)).click();
            await page.locator('input[name=phone]').fill('01000000001');
            await page.locator('input[name=name]').fill('가상 로컬 검사');
            await page.locator('label.opt').filter({ has: page.locator('input[name=buddy_room][value="혼자"]') }).click();
          }
          await page.locator('[name=sv_review]').fill('가상 로컬 검증: 일상을 나누며 대화할 수 있어서 좋았어요.');
          await page.locator('[name=sv_wish]').fill('가상 로컬 검증: 다음에는 대화 주제가 더 다양했으면 좋겠어요.');
          assert(await page.locator('#f').evaluate(el => el.scrollWidth <= document.documentElement.clientWidth + 1));
          await page.screenshot({ path: `${out}/${engine === webkit ? 'webkit' : 'chromium'}-${width}-${choice}.png`, fullPage: true });
          const sent = page.waitForRequest(r => r.url().endsWith('/api/submit') && r.method() === 'POST');
          const received = page.waitForResponse(r => r.url().endsWith('/api/submit'));
          await page.locator('#submit').click();
          const payload = (await sent).postDataJSON();
          const accepted = await received;
          assert.equal(accepted.status(), 200);
          assert.equal(payload.path, '/rejoin/7/seoul/');
          assert.equal(payload.fields.sv_join, choice);
          assert.equal(payload.hidden.g, 'f');
          assert.equal(payload.hidden.src, 'rejoin-7-msg');
          await page.getByRole('heading', { name: choice === '후기만' ? '후기 고마워요 💌' : '신청이 접수됐어요 💌' }).waitFor();
          submissions.push({ width, choice, result: await accepted.json() });
          checks.push(`${width}px ${choice}: correct fields, fixed fee, no horizontal overflow, local submission accepted`);
        } finally { await context.close(); }
      }
    }
    for (const closed of [['8'], ['8', '9']]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort();
          if (url.pathname === '/api/cohort' && closed.some(c => url.searchParams.get('path')?.startsWith(`/${c}/`)))
            return route.fulfill({ json: { open: false, serverNow: Date.now() } });
          return route.continue();
        });
        const page = await context.newPage();
        await page.goto(origin + path);
        await page.waitForFunction(({ closed }) => [...document.querySelectorAll('.q[data-name=sv_join] .opt[data-path]')]
          .filter(e => !e.hidden).length === 2 - closed.length, { closed });
        const visible = await page.locator('.q[data-name=sv_join] .opt[data-path]:visible input').evaluateAll(elements => elements.map(e => e.value));
        assert.deepEqual(visible, closed.length === 1 ? ['9기'] : []);
        assert.equal(await page.locator('input[name=sv_join]:checked').inputValue(), '후기만');
        checks.push(`Closed cohorts ${closed.join(',')}: only open options remain, anonymous review still default`);
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    const result = { engine: engine === webkit ? 'webkit' : 'chromium', checks, errors, submissions,
      production_requests_allowed: false, real_payments_executed: false };
    fs.writeFileSync(`${out}/result-${result.engine}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
