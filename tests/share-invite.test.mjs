import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const origin = 'https://join.haruharu.co.kr';
const rejoinPaths = ['/4/seoul/rejoin/', '/4/gwangju/rejoin/'];
const genders = [['여성', 'f'], ['남성', 'm']];

// Execute the script shipped to users, with only the DOM surface used by sharing.
// Other page scripts, network calls, and price-controller timers do not run here.
function invitation(path, gender = '여성', { native, clipboard = true, clipboardFails = false, legacyCopies = true } = {}) {
  const html = readFileSync(new URL('../public' + path + 'index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]).filter((script) => script.includes('friend_invite_click') && script.includes('SHARE_ONLY'));
  assert.equal(scripts.length, 1, path + ' has one invitation handler');

  const calls = { native: [], clipboard: [], legacy: [], prompts: [] };
  const button = new EventTarget(), label = { textContent: '친구에게 공유하기' }, attributes = new Map();
  button.querySelector = () => label;
  button.getAttribute = (name) => attributes.get(name) || null;
  button.setAttribute = (name, value) => attributes.set(name, value);
  button.closest = () => ({ getAttribute: () => '3' });
  const form = new EventTarget();
  form.querySelector = (selector) => selector === 'input[name="gender"]:checked' ? { value: gender } : null;
  const appended = new Set();
  let selected;
  const document = {
    getElementById: (id) => id === 'f' ? form : null,
    querySelectorAll: (selector) => {
      assert.equal(selector, '.fr-share');
      return [button];
    },
    createElement: (tag) => {
      assert.equal(tag, 'textarea');
      const textarea = { value: '', style: {}, setAttribute() {}, select() { selected = textarea; }, setSelectionRange() {} };
      return textarea;
    },
    body: { appendChild: (node) => appended.add(node), removeChild: (node) => appended.delete(node) },
    execCommand: (command) => {
      assert.equal(command, 'copy');
      calls.legacy.push(selected.value);
      return legacyCopies;
    },
  };
  const navigator = {};
  if (native) navigator.share = (payload) => { calls.native.push({ ...payload }); return native(payload); };
  if (clipboard) navigator.clipboard = { writeText: (url) => {
    calls.clipboard.push(url);
    return clipboardFails ? Promise.reject(new Error('Clipboard denied')) : Promise.resolve();
  } };
  runInNewContext(scripts[0], {
    document, navigator, window: {},
    location: { origin, pathname: path, search: '?src=original-private-source&phone=01012345678&buddy=01087654321&g=x' },
    setTimeout() {},
    prompt: (message, url) => calls.prompts.push({ message, url }),
  }, { filename: 'public' + path + 'index.html:invitation' });
  return {
    calls, label, appended,
    async click() { button.dispatchEvent(new Event('click')); await new Promise(setImmediate); },
  };
}

test('서울/광주 남녀 재참여 링크의 웹 공유는 같은 4,900원 폼과 선택 성별만 전달한다', async () => {
  for (const path of rejoinPaths) for (const [gender, code] of genders) {
    const page = invitation(path, gender, { native: () => Promise.resolve() });
    await page.click();
    assert.equal(page.calls.native.length, 1);
    const payload = page.calls.native[0];
    assert.equal(payload.title, '하루하루 소개팅');
    assert.equal(payload.url, origin + path + '?g=' + code + '&src=h4-friend-rejoin');
    assert.match(payload.text, /친구도 4,900원/);
    assert.doesNotMatch(payload.text, /2,000원|5,900원|7,900원/);
    const url = new URL(payload.url);
    assert.deepEqual([...url.searchParams.keys()], ['g', 'src'], '개인 번호와 원래 쿼리를 공유하지 않는다');
    assert.deepEqual(page.calls.clipboard, []);
    assert.deepEqual(page.calls.legacy, []);
    assert.deepEqual(page.calls.prompts, []);
    assert.equal(page.label.textContent, '친구에게 공유하기');
  }
});

test('일반 개선 폼의 공유는 기존 지역/성별, h4-friend 유입 코드와 친구 할인 문구를 유지한다', async () => {
  for (const path of ['/4/seoul/v2/', '/4/gwangju/v2/']) for (const [gender, code] of genders) {
    const page = invitation(path, gender, { native: () => Promise.resolve() });
    await page.click();
    const payload = page.calls.native[0];
    assert.equal(payload.url, origin + path + '?g=' + code + '&src=h4-friend');
    assert.match(payload.text, /둘 다 2,000원 할인/);
    assert.doesNotMatch(payload.text, /4,900원/);
  }
});

test('웹 공유 API가 없으면 재참여 링크를 클립보드에 복사하고 완료 표시를 보여 준다', async () => {
  const page = invitation('/4/gwangju/rejoin/', '남성');
  await page.click();
  assert.deepEqual(page.calls.clipboard, [origin + '/4/gwangju/rejoin/?g=m&src=h4-friend-rejoin']);
  assert.deepEqual(page.calls.native, []);
  assert.deepEqual(page.calls.legacy, []);
  assert.deepEqual(page.calls.prompts, []);
  assert.equal(page.label.textContent, '링크를 복사했어요');
});

test('공유 창에서 취소하면 링크를 복사하거나 주소 입력창을 띄우지 않는다', async () => {
  const page = invitation('/4/seoul/rejoin/', '여성', { native: () => Promise.reject({ name: 'AbortError' }) });
  await page.click();
  assert.equal(page.calls.native.length, 1);
  assert.deepEqual(page.calls.clipboard, []);
  assert.deepEqual(page.calls.legacy, []);
  assert.deepEqual(page.calls.prompts, []);
  assert.equal(page.label.textContent, '친구에게 공유하기');
});

test('웹 공유 API가 존재해도 사용을 거부하면 같은 재참여 링크 복사로 이어진다', async () => {
  const page = invitation('/4/seoul/rejoin/', '여성', { native: () => Promise.reject({ name: 'NotAllowedError' }) });
  await page.click();
  assert.equal(page.calls.native.length, 1);
  assert.deepEqual(page.calls.clipboard, [page.calls.native[0].url]);
  assert.deepEqual(page.calls.prompts, []);
  assert.equal(page.label.textContent, '링크를 복사했어요');
});

test('클립보드 API가 없거나 거부되면 브라우저 복사를 시도하고 임시 입력칸을 제거한다', async () => {
  for (const options of [{ clipboard: false }, { clipboardFails: true }]) {
    const page = invitation('/4/gwangju/rejoin/', '여성', options);
    await page.click();
    assert.deepEqual(page.calls.legacy, [origin + '/4/gwangju/rejoin/?g=f&src=h4-friend-rejoin']);
    assert.equal(page.appended.size, 0);
    assert.deepEqual(page.calls.prompts, []);
    assert.equal(page.label.textContent, '링크를 복사했어요');
  }
});

test('클립보드와 브라우저 복사가 모두 막히면 복사할 재참여 주소를 보여 준다', async () => {
  const page = invitation('/4/seoul/rejoin/', '남성', { clipboardFails: true, legacyCopies: false });
  await page.click();
  const expected = origin + '/4/seoul/rejoin/?g=m&src=h4-friend-rejoin';
  assert.deepEqual(page.calls.clipboard, [expected]);
  assert.deepEqual(page.calls.legacy, [expected]);
  assert.deepEqual(page.calls.prompts, [{ message: '아래 주소를 복사해 친구에게 보내 주세요', url: expected }]);
  assert.equal(page.appended.size, 0);
  assert.equal(page.label.textContent, '친구에게 공유하기');
});
