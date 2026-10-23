// Run against a separate local Wrangler instance seeded with synthetic responses.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const origin = process.env.GALLERY_QA_ORIGIN || 'http://localhost:8897';
if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw Error('QA must use a local server');
const out = process.env.GALLERY_QA_OUTPUT || '/tmp/haruharu-gallery-qa';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const engine = process.env.GALLERY_QA_BROWSER === 'webkit' ? webkit : chromium;
  const browser = await engine.launch({ headless: true, ...(engine === chromium && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, locale: 'ko-KR', acceptDownloads: true, ignoreHTTPSErrors: true });
  const page = await context.newPage(), errors = [], checks = [];
  page.setDefaultTimeout(15000); page.on('pageerror', (error) => errors.push(error.message));
  const check = (name) => { checks.push(name); console.log('PASS ' + name); };
  const gallery = page.locator('.sg-overlay');
  const filter = (key) => gallery.locator('[data-cohort="' + key + '"]').first();
  try {
    // Remove only prior submissions created by this exact local QA scenario.
    const existing = await (await context.request.get(origin + '/api/export?token=local-gallery&type=submissions&format=json')).json();
    for (const record of existing.filter((r) => r.survey?.sv_review.startsWith('가상 QA:'))) {
      const key = 's:' + record.submitted_at.replace(/[^0-9]/g, '') + '-' + record.id.slice(0, 8);
      assert.equal((await context.request.delete(origin + '/api/records?token=local-gallery&key=' + encodeURIComponent(key))).status(), 200);
    }
    await page.goto(origin + '/admin/'); await page.locator('#pw').fill('local-gallery-test');
    await page.getByRole('button', { name: '들어가기', exact: true }).click();
    await page.locator('#svBtn').waitFor({ state: 'visible' }); await page.locator('#svBtn').click();
    await gallery.getByRole('heading', { name: '후기와 바라는 점' }).waitFor();
    assert.equal(await gallery.locator('.sg-card').count(), 8);
    assert.equal(await filter('7').count(), 0);
    await filter('5').click(); assert.equal(await gallery.locator('.sg-card').count(), 3);
    assert((await gallery.locator('.sg-card').allInnerTexts()).every((text) => text.includes('5기 참가자')));
    assert.equal(await gallery.locator('.sg-cohort').filter({ hasText: '(추정)' }).count(), 0);
    assert.equal(await gallery.locator('.sg-cohort[title="이전 송금확인 기록"]').count(), 1);
    assert.equal(await page.evaluate(() => window.QA_INJECTION), undefined);
    check('Actual local D1 responses group by past participation and show paid-record cohorts without an estimate label');
    await gallery.getByRole('tab', { name: /^바라는 점/ }).click();
    assert.equal(await filter('5').getAttribute('aria-pressed'), 'true'); assert.equal(await gallery.locator('.sg-card').count(), 3);
    assert.match(await gallery.locator('.sg-text').first().innerText(), /다음에는/);
    await filter('unknown').click(); assert.equal(await gallery.locator('.sg-card').count(), 1);
    assert.match(await gallery.locator('.sg-cohort').innerText(), /기수 미확인/);
    check('Topic switching keeps cohort selection; anonymous historical responses remain unconfirmed');
    await filter('all').click(); await gallery.getByRole('tab', { name: /^후기/ }).click();
    await filter('4').click(); assert.equal(await gallery.locator('.sg-card').count(), 2);
    assert((await gallery.innerText()).includes('<script>window.QA_INJECTION=true</script>'));
    assert.equal(await page.evaluate(() => window.QA_INJECTION), undefined);
    check('Feedback is rendered as escaped text including script-like content');
    await filter('all').click();
    assert.equal(await gallery.locator('.sg-card-foot,.sg-author,.sg-save').count(), 0);
    const header = gallery.locator('.sg-card-head').first();
    assert.deepEqual(await header.locator('span,time').allTextContents(), ['5기 참가자', '여성', '2026.10.19']);
    assert.equal(await gallery.locator('.sg-gender').filter({ hasText: '성별 미확인' }).count(), 1);
    for (const size of [{ width: 1440, height: 1040 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 740 }]) {
      await page.setViewportSize(size);
      await gallery.locator('.sg-shell').evaluate((el) => { el.scrollTop = 0; });
      assert(await gallery.locator('.sg-shell').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      const positions = await gallery.locator('.sg-card').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom }; }));
      assert(positions.every((row) => Math.abs(row.left - positions[0].left) < 1));
      assert(positions.every((row, i) => !i || row.top >= positions[i - 1].bottom - 1));
      await page.screenshot({ path: out + '/rows-' + size.width + '.png' });
    }
    check('Each response occupies a full row at desktop and mobile widths; headers show cohort, gender and date without a footer');
    await page.keyboard.press('Escape'); await gallery.waitFor({ state: 'hidden' });
    assert(await page.locator('#svBtn').evaluate((el) => document.activeElement === el));
    await page.locator('#svBtn').click(); await gallery.locator('[data-close]').focus(); await page.keyboard.press('Shift+Tab');
    assert(await gallery.locator('.sg-details summary').last().evaluate((el) => document.activeElement === el));
    check('Dialog restores focus and includes the review details controls in keyboard navigation');
    await context.clearCookies(); await page.evaluate(() => document.getElementById('refreshBtn').click());
    await page.locator('#login').waitFor({ state: 'visible' }); await gallery.waitFor({ state: 'hidden' });
    check('Expired admin session closes review content');

    await page.goto(origin + '/rejoin/seoul/');
    await page.locator('[name=sv_review]').fill('가상 QA: 지난 기수에서 소소한 일상을 나누는 게 좋았어요.');
    await page.locator('[name=sv_wish]').fill('가상 QA: 다음에는 함께 이야기할 시간이 더 많았으면 좋겠어요.');
    await page.locator('#submit').click(); await page.locator('.sv-cohort-q.bad').waitFor();
    await page.locator('[data-sv-cohort="5"]').click(); await page.locator('[data-sv-cohort="4"]').click();
    assert.deepEqual(JSON.parse(await page.locator('[name=sv_cohorts]').inputValue()), ['5', '4']);
    await page.locator('[data-sv-cohort="unknown"]').click(); assert.equal(await page.locator('[name=sv_cohorts]').inputValue(), '["unknown"]');
    await page.locator('[data-sv-cohort="5"]').click();
    await page.reload(); await page.waitForFunction(() => document.querySelector('[data-sv-cohort="5"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('[name=sv_cohorts]').inputValue(), '["5"]');
    await page.screenshot({ path: out + '/review-form-mobile.png', fullPage: true });
    const responseEvent = page.waitForResponse((response) => response.url().endsWith('/api/submit'));
    await page.locator('#submit').click(); const response = await responseEvent;
    assert.equal(response.status(), 200); await page.getByRole('heading', { name: '후기 고마워요 💌' }).waitFor();
    const saved = await (await context.request.get(origin + '/api/export?token=local-gallery&type=submissions&format=json')).json();
    const latest = saved.filter((r) => r.survey?.sv_review.startsWith('가상 QA:')).at(-1);
    assert(latest); assert.deepEqual(latest.survey.sv_cohorts, ['5']); assert.equal(latest.phone_digits, ''); assert.equal(latest.hidden.cohort, 'review');
    await context.request.post(origin + '/api/admin/login', { data: { password: 'local-gallery-test' } });
    const applicants = await (await context.request.get(origin + '/api/admin/applicants')).json();
    assert.deepEqual(JSON.parse(applicants.rows.find((r) => r.application_id === latest.id).survey).sv_cohorts, ['5']);
    check('Actual anonymous submission saves selected past cohort, preserves drafts and keeps the review-only flow');
    assert.deepEqual(errors, []);
    fs.writeFileSync(out + '/browser-results.json', JSON.stringify({ checks, errors, origin, syntheticOnly: true }, null, 2));
  } catch (error) {
    await page.screenshot({ path: out + '/failure.png' }); fs.writeFileSync(out + '/failure.txt', String(error) + '\n' + await page.locator('body').innerText()); throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
