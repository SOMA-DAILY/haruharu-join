// Local-only end-to-end checks. Never sends test submissions or analytics to production.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const origin = process.env.REVIEW_QA_ORIGIN || 'http://127.0.0.1:8909';
if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw Error('Local QA only');
const out = process.env.REVIEW_QA_OUTPUT || '/tmp/haruharu-review6-qa';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const engine = process.env.REVIEW_QA_BROWSER === 'webkit' ? webkit : chromium;
  const browser = await engine.launch({ headless: true,
    ...(engine === chromium && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const checks = [], errors = [];
  try {
    for (const [g, width] of [['m',390],['f',390],['m',360]]) {
      const context = await browser.newContext({viewport:{width,height:844},locale:'ko-KR'});
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(origin+'/rejoin/seoul/?src=rejoin-msg&g='+g);
        assert.equal(new URL(page.url()).pathname,'/rejoin/6/seoul/');
        assert.equal(new URL(page.url()).searchParams.get('g'),g);
        assert.equal(new URL(page.url()).searchParams.get('src'),'rejoin-6-msg');
        await page.getByRole('heading',{name:'6기, 어땠어요?'}).waitFor();
        const options = page.locator('.q[data-name=sv_join] .opt[data-path]:visible');
        await page.waitForFunction(({g}) => {
          const values=[...document.querySelectorAll('.q[data-name=sv_join] .opt[data-path]')]
            .filter(el=>!el.hidden).map(el=>el.querySelector('input').value);
          return JSON.stringify(values)===JSON.stringify(g==='m'?['8기']:['7기','8기']);
        },{g});
        assert.equal(await options.count(),g==='m'?1:2);
        assert.equal(await page.locator('input[name=sv_join]:checked').inputValue(),'후기만');
        assert.equal(await page.locator('.q[data-name=phone]').isVisible(),false);
        const join8 = page.locator('.q[data-name=sv_join] .opt[data-path="/8/seoul/rejoin/from-6/"]');
        await join8.click();
        assert.equal(await page.locator('.q[data-name=phone]').isVisible(),true);
        assert.match(await page.locator('#f').innerText(),/5,900원/);
        assert(!/3,900원/.test(await page.locator('#f').innerText()));
        assert(await page.locator('#f').evaluate(el=>el.scrollWidth<=document.documentElement.clientWidth+1));
        await page.screenshot({path:out+'/'+g+'-'+width+'.png',fullPage:true});
        // Deselecting reapplication must still permit an anonymous review.
        await join8.click();
        assert.equal(await page.locator('input[name=sv_join]:checked').inputValue(),'후기만');
        await page.locator('[name=sv_review]').fill('가상 QA: 일상을 나누며 대화할 수 있어서 좋았어요.');
        await page.locator('[name=sv_wish]').fill('가상 QA: 다음에는 대화 주제가 더 다양했으면 좋겠어요.');
        const submitted = page.waitForResponse(response=>response.url().endsWith('/api/submit'));
        await page.locator('#submit').click();
        assert.equal((await submitted).status(),200);
        await page.getByRole('heading',{name:'후기 고마워요 💌'}).waitFor();
        checks.push(g+' '+width+': old link redirects, gender options/fee correct, anonymous local review accepted');
      } finally { await context.close(); }
    }
    // A failed/closed 8th-cohort request must never fall back to showing 7th to men.
    const context = await browser.newContext({viewport:{width:390,height:844}});
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if(url.origin!==origin) return route.abort();
        if(url.pathname==='/api/cohort' && url.searchParams.get('path')?.startsWith('/8/'))
          return route.fulfill({json:{open:false,serverNow:Date.now()}});
        return route.continue();
      });
      const page=await context.newPage();
      await page.goto(origin+'/rejoin/6/seoul/?src=rejoin-6-msg&g=m');
      await page.locator('.q[data-name=sv_join]').waitFor({state:'hidden'});
      assert.equal(await page.locator('.q[data-name=sv_join] .opt[data-path]:visible').count(),0);
      checks.push('When 8th closes, men see review only; 7th never reappears');
    } finally { await context.close(); }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(out+'/result-'+(engine===webkit?'webkit':'chromium')+'.json',JSON.stringify({checks,errors},null,2));
    console.log(JSON.stringify({checks,errors},null,2));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
