import { earlyOffer } from '../../shared/early-offer.mjs';
import { FESTIVAL_PLAN, AVOID_MAJOR_VALUES, isFestival, festivalStatus, decodeCapture, sniffImage, captureExpiration } from '../../shared/jnu-festival.mjs';
import { cohortStatus, formOf, formStatus, CURRENT_COHORT } from '../../shared/forms.mjs';
import { friendFee } from '../../shared/friend-discount.mjs';
import { cleanSurvey } from '../../shared/rejoin-survey.mjs';

// Cloudflare Pages Function — 신청폼 백엔드
// POST /api/partial  : 방문/입력 상태 (랜딩, 입력 중, 이탈, 체류시간). D1 sessions 에 sid+path 1행으로 upsert
// POST /api/submit   : 최종 제출. 정본 KV s: + D1 submissions 사본. 전남대 축제 폼은 학생 인증 캡처를 KV img:{신청ID} 에 따로 저장
// GET  /api/festival : 전남대 축제 폼 마감 여부 (서버 시각 기준)
// GET  /api/cohort   : 기수 본모집 폼(일반/사전알림/할인, 지역 선택) 마감 여부 (서버 시각 기준)
// GET  /api/export?token=..&type=submissions|partials&format=csv|json
// GET  /api/stats?token=..  : 단계별 도달 수 (도착 → 입력 시작 → 1페이지 완료 → 제출)
// /api/admin/*       : 관리 페이지 (비밀번호 로그인 쿠키)

const KST = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
const EXPERIENCE_VALUES = ['dating_app', 'friend_intro', 'offline', 'setlog_haruharu', 'none'];   // src/done-survey.html 보기와 같음
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
// /api/export CSV 는 시트 IMPORTDATA 가 열 위치로 읽을 수 있음 → BASE_FIELDS 순서와 기존 열 위치는 바꾸지 말고, 새 입력값은 FESTIVAL_FIELDS 로 CSV 맨 끝에만 붙임
const BASE_FIELDS = ['gender', 'birth_year', 'school', 'source', 'device', 'intent', 'intent_other', 'phone', 'consent', 'marketing', 'name', 'buddy', 'buddy_room'];   // marketing (10/14): 선택 동의 [할인, 모집 소식 문자 받기]. 임시 저장(sessions.fields)과 KV 정본의 fields 에만 남음 (D1 submissions 열 없음)
const FESTIVAL_FIELDS = ['major', 'avoid_same_major'];
// 4기 직장인 사전알림 문항. 하시는 일은 school 칸을 그대로 씀(라벨만 다름), 편한 진행 시기만 새 칸
const WORK_FIELDS = ['schedule_pref'];
// 캡처 이미지는 FIELDS 에 넣지 않음: /partial(D1 sessions.fields)로는 절대 안 들어가게 제출 본문의 capture 로만 받음
const FIELDS = [...BASE_FIELDS, ...FESTIVAL_FIELDS, ...WORK_FIELDS];
const HIDDEN = ['src', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'city', 'cohort', 'channel', 'plan', 'device_auto', 'arm'];   // arm (10/20): 50/50 팔 a|b (functions/7/seoul 쿠키)
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|facebot|meta-externalagent|preview|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http/i;

async function readBody(request) {
  try { return JSON.parse(await request.text()); } catch (e) { return null; }
}
function clean(fields) {
  const o = {};
  for (const k of FIELDS) if (fields && typeof fields[k] === 'string') o[k] = fields[k].slice(0, 200);
  return o;
}
function cleanHidden(h) {
  const o = {};
  for (const k of HIDDEN) if (h && typeof h[k] === 'string') o[k] = h[k].slice(0, 200);
  return o;
}
function normPhone(p) { return (p || '').replace(/\D/g, ''); }
// 전화번호만 받는 재참여 폼(등록부 phoneOnly): 같은 번호의 지난 신청에서 성별/출생년도/학교/기기를 가져옴 (칸마다 가장 최근에 적은 값).
//   못 찾아도 접수는 받음(번호가 등록돼 있는지 화면으로 알 수 없게). 그때는 칸이 빈 채로 남고 관리 화면에 [이전 기록 없음]
const PRIOR_FIELDS = ['gender', 'birth_year', 'school', 'device'];
async function priorProfile(env, digits) {
  const out = {};
  if (!env.DB || !digits) return out;
  try {
    const rows = await env.DB.prepare('SELECT application_id, gender, birth_year, school, device FROM submissions WHERE phone_digits = ?1 ORDER BY submitted_ts DESC LIMIT 20').bind(digits).all();
    for (const r of rows.results || []) {
      if (!out.from) out.from = r.application_id;
      for (const k of PRIOR_FIELDS) if (!out[k] && r[k]) out[k] = r[k];
    }
  } catch (e) {}
  return out;
}
// 친구 칸: 전화번호면 숫자만 저장. 옛 화면에서 이름으로 들어온 값은 그대로 둠
function buddyVal(v) { const d = normPhone(v); return /^01\d{8,9}$/.test(d) ? d : (v || ''); }
function normPath(p, city) {
  if (typeof p === 'string' && /^\/[a-z0-9\-/]*$/i.test(p)) { p = p.slice(0, 80); return p.endsWith('/') ? p : p + '/'; }
  return city && city !== 'select' ? '/' + city + '/' : '/';
}
function device(ua) { return /iphone|ipad|ipod/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mobile/i.test(ua) ? '기타 모바일' : 'PC'; }
// 메타 광고 검토 크롤러 (10/10): 광고 링크(fbclid)인데 facebook.com 리퍼러 + 인앱 아닌 일반 브라우저 UA. 새 광고 켤 때 몰려옴, 이력 506건 중 제출 0
// 우리 광고는 인스타 지면만이라 실사용자는 인스타/페북 인앱으로 들어옴
const FB_REF = /^https?:\/\/([a-z0-9-]+\.)*facebook\.com(\/|$)/i;
function isBot(ua, ref, fbclid) { return BOT.test(ua) || (!!fbclid && FB_REF.test(String(ref || '')) && !inApp(ua)); }
function inApp(ua) { return /Instagram/i.test(ua) ? '인스타' : /FBAN|FBAV|FB_IAB/i.test(ua) ? '페이스북' : /KAKAOTALK/i.test(ua) ? '카카오톡' : /Line\//i.test(ua) ? '라인' : /everytime/i.test(ua) ? '에브리타임' : ''; }
// 폼 이름: 등록부에 있으면 그 라벨, 없으면 옛 규칙
function formName(path, h) {
  const f = formOf(path);
  if (f) return f.label + ' 신청폼';
  if (isFestival(path, h.plan)) return '전남대 축제 신청폼';
  return (h.city === 'seoul' ? '서울 신청폼' : h.city === 'gwangju' ? '광주 신청폼' : path) + (h.plan === 'early' ? ' (사전알림 4,900)' : h.plan === 'discount' ? ' (할인 4,900)' : '');
}
const num = (v, max) => { v = Math.round(Number(v) || 0); return v < 0 ? 0 : Math.min(v, max); };

// 메타 전환 API (10/7). 주 픽셀 haruharu.ting 에 서버에서 같은 이벤트를 보냄 → 브라우저 픽셀과 event_id 로 합쳐짐
// 토큰은 secret META_CAPI_TOKEN, 테스트 땐 META_TEST_EVENT_CODE (이벤트 관리자 테스트 탭에만 보이고 실데이터에 안 섞임). 토큰 없으면 아무것도 안 보냄
// D1/KV 안 씀. 응답을 기다리지 않게 waitUntil 로 보냄
const CAPI_PIXEL = '1144224341416623';
const CAPI_EVENTS = ['LandingEngaged', 'FormStart', 'Page1Complete', 'PayButtonClick'];
async function sha256(v) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const cstr = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
async function capiUser(request, b, extra) {
  const u = { client_ip_address: request.headers.get('cf-connecting-ip') || undefined, client_user_agent: request.headers.get('user-agent') || undefined };
  const fbp = cstr(b.fbp, 200), fbc = cstr(b.fbc, 300);
  if (/^fb\.\d\./.test(fbp)) u.fbp = fbp;
  if (/^fb\.\d\./.test(fbc)) u.fbc = fbc;
  if (typeof b.sid === 'string' && b.sid) u.external_id = [await sha256(b.sid.slice(0, 64).toLowerCase())];
  return Object.assign(u, extra || {});
}
async function capiSend(env, ev) {
  // 로컬 시험용: CAPI_DRY_RUN 이 있으면 메타로 안 보내고 이벤트 이름만 찍음 (.dev.vars)
  if (env.CAPI_DRY_RUN) { console.log('[capi dry]', ev.event_name, (ev.custom_data || {}).content_category || ''); return; }
  if (!env.META_CAPI_TOKEN) return;
  const body = { data: [ev] };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${CAPI_PIXEL}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (env.META_TEST_EVENT_CODE) console.log('[capi]', ev.event_name, r.status, await r.text());
  } catch (e) {}
}
function capiCustom(c) {
  const o = {};
  if (c && typeof c === 'object') for (const k of ['channel', 'city', 'content_name', 'content_category']) if (typeof c[k] === 'string') o[k] = c[k].slice(0, 100);
  return o;
}
async function capiEvent(request, b, name, eventId, user, custom) {
  return {
    event_name: name, event_time: Math.floor(Date.now() / 1000), event_id: cstr(eventId, 120) || undefined, action_source: 'website',
    event_source_url: cstr(b.url, 500) || undefined, user_data: await capiUser(request, b, user), custom_data: capiCustom(custom),
  };
}

async function trackSession(env, request, b) {
  if (!env.DB) return;
  const h = cleanHidden(b.hidden);
  const path = normPath(b.path, h.city);
  const ua = String(b.ua || request.headers.get('user-agent') || '').slice(0, 300);
  const f = clean(b.fields);
  // 자동으로 채운 기기값만 있는 건 입력으로 안 침 (9/28: 아무것도 안 쓴 방문이 입력 시작으로 잡혔음)
  const filled = Object.keys(f).filter((k) => !(k === 'device' && h.device_auto)).length;
  const now = Date.now();
  // 알림 신청(alert_submit, 10/11)은 신청서 입력이 아니라서 그것만으로는 입력 시작으로 안 셈 (5기 퍼널 [쓰다 나감] 오염 방지)
  const started = filled > 0 || (!!b.last_field && b.last_field !== 'alert_submit') ? 1 : 0;
  const kind = path === '/' ? 'landing' : 'form';
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO forms (path, name, kind, city, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(path, path === '/' ? '지역 선택 랜딩' : formName(path, h), kind, (formOf(path) || {}).city || (h.city && h.city !== 'select' ? h.city : null), now),
    env.DB.prepare(`INSERT INTO sessions (sid, path, city, src, channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid,
        ref, ua, device, in_app, is_bot, is_return, first_ts, last_ts, active_ms, max_scroll, started, started_ts, max_page, last_field, fields, filled, next_click)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27)
      ON CONFLICT(sid, path) DO UPDATE SET
        last_ts = excluded.last_ts,
        active_ms = MAX(sessions.active_ms, excluded.active_ms),
        max_scroll = MAX(sessions.max_scroll, excluded.max_scroll),
        started = MAX(sessions.started, excluded.started),
        started_ts = COALESCE(sessions.started_ts, excluded.started_ts),
        max_page = MAX(sessions.max_page, excluded.max_page),
        last_field = CASE WHEN excluded.last_field <> '' THEN excluded.last_field ELSE sessions.last_field END,
        fields = CASE WHEN excluded.filled > 0 AND sessions.submitted = 0 THEN excluded.fields ELSE sessions.fields END,
        filled = CASE WHEN excluded.filled > 0 AND sessions.submitted = 0 THEN excluded.filled ELSE sessions.filled END,
        next_click = COALESCE(excluded.next_click, sessions.next_click)`)
      .bind(String(b.sid).slice(0, 64), path, h.city || null, h.src || null, h.utm_content || h.src || 'direct',
        h.utm_source || null, h.utm_medium || null, h.utm_campaign || null, h.utm_content || null, h.utm_term || null, h.fbclid ? 1 : 0,
        String(b.ref || '').slice(0, 300), ua, device(ua), inApp(ua), isBot(ua, b.ref, h.fbclid) ? 1 : 0, b.returning ? 1 : 0,
        now, num(b.active_ms, 6 * 3600e3), num(b.max_scroll, 100), started, started ? now : null,
        num(b.page, 9) || 1, String(b.last_field || '').slice(0, 40), filled ? JSON.stringify(f) : null, filled,
        typeof b.next_click === 'string' ? b.next_click.slice(0, 40) : null),
  ]);
  // 사람 단위 퍼널용 (migrations/0012). 기기 id 는 페이지당 첫 기록, 송금은 누른 뒤에만 와서 방문당 1~2줄만 더 씀. 열이 없으면 조용히 넘어감
  const did = typeof b.did === 'string' && /^[\w-]{8,64}$/.test(b.did) ? b.did : null;
  if (did || b.pay) {
    try {
      await env.DB.prepare('UPDATE sessions SET did = COALESCE(did, ?3), pay = MAX(COALESCE(pay, 0), ?4) WHERE sid = ?1 AND path = ?2')
        .bind(String(b.sid).slice(0, 64), path, did, b.pay ? 1 : 0).run();
    } catch (e) {}
  }
  // 50/50 팔 라벨 (migrations/0015). 첫 기록 값 유지. 열이 없으면 조용히 넘어감
  if (h.arm === 'a' || h.arm === 'b') {
    try { await env.DB.prepare('UPDATE sessions SET arm = COALESCE(arm, ?3) WHERE sid = ?1 AND path = ?2').bind(String(b.sid).slice(0, 64), path, h.arm).run(); } catch (e) {}
  }
}

export async function onRequest({ request, env, params, waitUntil }) {
  const url = new URL(request.url);
  const path = '/' + (params.path ? [].concat(params.path).join('/') : '');
  if (request.method === 'GET' && path === '/early-offer') return json(earlyOffer());
  if (request.method === 'GET' && path === '/festival') return json(festivalStatus(Date.now(), env));
  if (request.method === 'GET' && path === '/cohort') { const fp = url.searchParams.get('path'); return json(fp ? formStatus(fp, Date.now(), env) : cohortStatus(Date.now(), env)); }
  const kv = env.APPLY_KV;
  if (!kv) return json({ error: 'KV binding missing' }, 500);

  if (request.method === 'POST' && path === '/partial') {
    const b = await readBody(request); if (!b || !b.sid) return json({ ok: false }, 400);
    try { await trackSession(env, request, b); } catch (e) { return json({ ok: false, error: String(e.message || e) }, 500); }
    return json({ ok: true });
  }

  if (request.method === 'POST' && path === '/capi') {
    const b = await readBody(request);
    if (!b || !CAPI_EVENTS.includes(b.event_name) || !formOf(b.path) || isBot(request.headers.get('user-agent') || '', b.ref, /[?&]fbclid=/.test(String(b.url || '')))) return json({ ok: false }, 400);
    waitUntil(capiEvent(request, b, b.event_name, b.event_id, null, b.custom_data).then((ev) => capiSend(env, ev)));
    return json({ ok: true });
  }

  // 완료 화면 선택 문항 (10/10): 최근 1년 소개팅 경험을 신청서에 붙임. 신청 ID 를 아는 본인만(UUID), 정해진 값만, 한 번만 (이미 있으면 그대로)
  if (request.method === 'POST' && path === '/experience') {
    const b = await readBody(request);
    const id = b && typeof b.id === 'string' && /^[0-9a-f-]{20,64}$/i.test(b.id) ? b.id : '';
    const vals = Array.isArray(b && b.methods) ? [...new Set(b.methods.filter((x) => EXPERIENCE_VALUES.includes(x)))] : [];
    if (!id || !vals.length) return json({ ok: false, error: 'bad body' }, 400);
    const v = vals.includes('none') ? 'none' : vals.join(',');
    let key = '';
    try { if (env.DB) { const row = await env.DB.prepare('SELECT kv_key FROM submissions WHERE application_id = ?1').bind(id).first(); key = row ? row.kv_key : ''; } } catch (e) {}
    if (!key || !key.startsWith('s:')) return json({ ok: false, error: 'not_found' }, 404);
    try {
      const rec = await kv.get(key, 'json');
      if (rec && !rec.dating_experience) { rec.dating_experience = v; await kv.put(key, JSON.stringify(rec)); }
    } catch (e) {}
    try { await env.DB.prepare("UPDATE submissions SET dating_experience = ?2 WHERE application_id = ?1 AND COALESCE(dating_experience, '') = ''").bind(id, v).run(); } catch (e) {}   // migrations/0010 없으면 KV 에만
    return json({ ok: true });
  }

  if (request.method === 'POST' && path === '/submit') {
    const b = await readBody(request); if (!b || !b.fields) return json({ ok: false, error: 'bad body' }, 400);
    const f = clean(b.fields);
    const h = cleanHidden(b.hidden);
    const now = Date.now();
    // 전남대 축제 폼: 경로나 plan 중 하나라도 축제면 축제 신청으로 보고 마감 시각과 캡처를 서버에서 확인 (화면만 막으면 우회 가능)
    const festival = isFestival(b.path, h.plan);
    if (festival) {
      h.plan = FESTIVAL_PLAN;
      if (!festivalStatus(now, env).open) return json({ ok: false, error: 'festival_closed', ...festivalStatus(now, env) }, 409);
    }
    // 재참여 후기 폼 (10/17~, 등록부 joins): 한 장에서 고른 값(sv_join)으로 접수할 기수 줄을 서버가 정함. 후기만이면 그 페이지 줄 그대로(무료, cohort 'review')
    //   방문 기록(sessions)은 페이지 경로(pagePath)로 남기고, 신청 사본(submissions)과 요금제/기수/마감은 고른 기수 줄로
    const pagePath = b.path, page = festival ? null : formOf(b.path);
    let reviewOnly = false;
    if (page && page.joins) {
      const target = formOf(page.joins[String((b.fields || {}).sv_join || '')] || '');
      if (!target) return json({ ok: false, error: 'missing', miss: ['sv_join'] }, 400);
      reviewOnly = target.path === page.path;
      b.path = target.path;
    }
    // 등록부(shared/forms.mjs)로 요금제/기수/지역을 서버가 확정 (클라이언트 hidden 값은 안 믿음). 등록부에 없는 경로는 받지 않음
    const form = festival ? null : formOf(b.path);
    if (!festival && !form) return json({ ok: false, error: 'unknown_form' }, 404);
    if (form) { h.plan = form.plan; h.cohort = form.cohort; h.city = form.city; }
    if (reviewOnly) h.plan = 'review';   // 후기만 (참가 신청 아님, 참가비 없음)
    // 기수 마감(그 기수 폼 전부): 화면만 막으면 우회 가능하니 서버에서도 거부. 저장 전에 끊어서 KV/D1 에 안 남음
    if (form) { const st = formStatus(b.path, now, env); if (!st.open) return json({ ok: false, error: 'cohort_closed', ...st }, 409); }
    const preRegistration = form && form.plan === 'early';
    const prealert = form && form.plan === 'prealert';
    // 필수: 사전알림(무료)은 송금자 이름/기기 없음. 직장인 폼의 school 칸은 [하시는 일]
    // lite: [다음 기수 알림만] 칸 (10/11). 성별, 출생년도, 번호, 동의만 받음
    const phoneOnly = !!(form && form.phoneOnly);
    const required = phoneOnly ? (reviewOnly ? [] : ['phone', 'name']) : festival ? ['gender', 'birth_year', 'major', 'phone', 'consent', 'name'] : (prealert && form.lite) ? ['gender', 'birth_year', 'phone', 'consent'] : prealert ? ['gender', 'birth_year', 'school', 'source', 'phone', 'consent'] : ['gender', 'birth_year', 'school', 'phone', 'consent', 'name'];
    if (!preRegistration && !festival && !prealert && !phoneOnly) {
      if (!form.rejoin && !form.noSource) required.push('source'); // 재참여 폼은 유입 경로 문항 없음
      required.push('device');
    }
    if (form && form.occupation) required.push('schedule_pref');
    const miss = required.filter((k) => !f[k]);
    // 재참여 설문 폼(등록부 survey): 설문을 다 해야 할인이라 빠진 문항이 있으면 받지 않음. 값은 선택지에 있는 것만 남김
    const sv = form && form.survey ? cleanSurvey(b.fields) : null;
    if (sv) miss.push(...sv.miss);
    let capture = null;
    if (festival) {
      capture = decodeCapture(b.capture);
      if (capture.error === 'capture_missing') miss.push('capture');
    }
    if (miss.length) return json({ ok: false, error: 'missing', miss }, 400);
    // 전화번호만 받는 재참여: 화면에 없는 문항 값은 버리고 지난 신청에서 채움. 기기는 지금 접속한 폰이 먼저
    let priorFrom = null;
    if (phoneOnly) {
      for (const k of ['gender', 'birth_year', 'school', 'source', 'device', 'intent', 'intent_other', 'consent']) delete f[k];   // 동의 체크 문항 없음 (이용 안내만)
      if (reviewOnly) for (const k of ['phone', 'name', 'buddy', 'buddy_room']) delete f[k];   // 후기만 (10/18 운영자: 전화번호는 신청하는 사람만): 전화번호, 참가비, 친구 칸은 화면에서 숨겨짐. 익명 후기
      const prior = reviewOnly ? {} : await priorProfile(env, normPhone(f.phone));
      for (const k of PRIOR_FIELDS) if (prior[k]) f[k] = prior[k];
      const ua = String(b.ua || '');
      const dv = /iphone|ipad|ipod/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : '';
      if (dv) f.device = dv;
      priorFrom = reviewOnly ? null : prior.from || '';   // 후기만은 번호가 없어 지난 신청을 안 찾음
    }
    if (capture && capture.error) return json({ ok: false, error: capture.error }, capture.error === 'capture_too_large' ? 413 : 400);
    if (festival) f.avoid_same_major = AVOID_MAJOR_VALUES.includes(f.avoid_same_major) ? f.avoid_same_major : '';
    // 신청 ID = 세션 UUID (랜딩부터 앱까지 한 사람을 잇는 키). Mixpanel distinct_id, 초대 코드 옆에 저장, 앱 identify 에 씀
    const sidOk = typeof b.sid === 'string' && /^[0-9a-f-]{20,64}$/i.test(b.sid);
    const id = sidOk ? b.sid : (crypto.randomUUID ? crypto.randomUUID() : KST(now).replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 7));
    if (h.plan === 'early' && form && form.cohort === '3' && !earlyOffer(now).active) {
      return json({ ok: false, error: 'early_expired', offer: earlyOffer(now) }, 409);
    }
    // 학생 인증 캡처는 KV img:{신청ID} 에 바이너리로 (CAPTURE_DELETE_AT 에 만료). 저장이 실패해도 신청은 받고(송금했을 수 있음) 관리 페이지에 '캡처 없음'으로 보임
    let cardKey = '';
    if (capture && capture.bytes) {
      try {
        const opts = { metadata: { type: capture.type, size: capture.bytes.length, ts: now } };
        opts.expiration = captureExpiration(now); // 행사 끝나면 자동 삭제 (늦게 들어오면 3일 뒤). 만료 없이 저장되는 경우 없음
        await kv.put('img:' + id, capture.bytes, opts);
        cardKey = 'img:' + id;
      } catch (e) {}
    }
    const rec = { id, application_id: id, sid: b.sid || '', submitted_at: KST(now), ts: now, track: form ? form.track : (festival ? 'festival' : ''), fields: f, phone_digits: normPhone(f.phone), hidden: h, ref: (b.ref || '').slice(0, 300), ua: (b.ua || '').slice(0, 200), ip: request.headers.get('cf-connecting-ip') || '' };
    // 친구 할인: 안내받은 금액을 서버가 등록부와 친구 문항으로 정해서 남김 (클라이언트 값 안 믿음). 대상 폼이 아니면 칸 자체를 안 만듦
    const ff = form && form.friendFee && !reviewOnly ? friendFee(form, f) : null;
    if (ff != null) rec.friend_fee = ff;
    if (priorFrom != null) rec.prior_from = priorFrom;   // 가져온 지난 신청 ID ('' = 못 찾음)
    if (sv) rec.survey = sv.survey;
    if (page && page.joins) rec.from_page = page.path;   // 재참여 후기 폼에서 고른 기수로 접수됨
    if (festival) { rec.student_card_key = cardKey; if (capture && capture.bytes && !cardKey) rec.capture_failed = true; }
    const kvKey = 's:' + KST(now).replace(/[^0-9]/g, '') + '-' + id.slice(0, 8);
    // 정본은 KV. KV 가 실패해도(쓰기 한도 등) D1 에 남으면 접수 처리, 둘 다 실패해야 에러
    let kvOk = true, dbOk = false;
    try { await kv.put(kvKey, JSON.stringify(rec)); } catch (e) { kvOk = false; }
    try { await kv.put('meta:last_submit', String(now)); } catch (e) {} // 관리 페이지 새 신청 감지용
    // D1 사본 + 세션 제출 표시. 실패해도 제출은 성공 처리 (정본은 KV)
    try {
      if (env.DB) {
        const p = normPath(b.path, h.city), sp = normPath(pagePath, h.city);   // sp: 방문 기록 경로 (재참여 후기 폼은 페이지 경로, 그 밖에는 p 와 같음)
        const noSess = !!(form && form.noPage) && !(page && page.joins);   // 알림 신청(화면 없음, 10/11): 방문 기록에 가짜 방문/제출을 만들지 않음. 신청 사본(submissions)만
        await env.DB.batch([
          env.DB.prepare(`INSERT OR REPLACE INTO submissions (application_id, kv_key, path, city, cohort, src, channel, submitted_ts, submitted_at,
              name, phone, phone_digits, gender, birth_year, school, source, device, intent, intent_other, consent, buddy, plan, status, memo, status_updated_at, room, buddy_room)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,
              COALESCE((SELECT status FROM submissions WHERE application_id=?1),''), COALESCE((SELECT memo FROM submissions WHERE application_id=?1),''), (SELECT status_updated_at FROM submissions WHERE application_id=?1), COALESCE((SELECT room FROM submissions WHERE application_id=?1),''), ?23)`)
            .bind(id, kvKey, p, h.city || null, h.cohort || null, h.src || null, h.utm_content || h.src || 'direct', now, KST(now),
              f.name || '', f.phone || '', normPhone(f.phone), f.gender || '', f.birth_year || '', f.school || '', f.source || '', f.device || '', f.intent || '', f.intent_other || '', f.consent || '', buddyVal(f.buddy), h.plan || '', f.buddy_room || ''),
          // 방문 기록이 먼저 못 들어온 경우(비콘 유실 등)에도 제출이 지표에서 빠지지 않게 행을 먼저 만듦
          ...(noSess ? [] : [env.DB.prepare(`INSERT OR IGNORE INTO sessions (sid, path, city, src, channel, ua, device, in_app, is_bot, first_ts, last_ts, started, started_ts, max_page)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9, 1, ?9, 3)`)
            .bind(String(b.sid || id).slice(0, 64), sp, h.city || null, h.src || null, h.utm_content || h.src || 'direct', String(b.ua || '').slice(0, 300), device(String(b.ua || '')), inApp(String(b.ua || '')), now),
          env.DB.prepare('UPDATE sessions SET submitted = 1, submitted_ts = ?3, application_id = ?4, max_page = 3, last_ts = ?3 WHERE sid = ?1 AND path = ?2')
            .bind(String(b.sid || id).slice(0, 64), sp, now, id)]),
        ]);
        dbOk = true;
      }
    } catch (e) {}
    // 축제 폼 전용 열(migrations/0007)은 위 batch 밖에서 따로 채움: 원격에 0007 이 빠져도 신청자 행은 남고 이 세 값만 빠짐 (정본 KV 에는 다 있음)
    if (festival && dbOk) {
      try {
        await env.DB.prepare('UPDATE submissions SET major = ?2, avoid_same_major = ?3, student_card_key = ?4 WHERE application_id = ?1')
          .bind(id, f.major || '', f.avoid_same_major || '', cardKey).run();
      } catch (e) {}
    }
    // 친구 할인 금액(migrations/0009)도 batch 밖에서: 원격에 0009 가 없어도 신청자 행은 남고 이 값만 빠짐 (정본 KV 에는 있음)
    if (ff != null && dbOk) {
      try { await env.DB.prepare('UPDATE submissions SET friend_fee = ?2 WHERE application_id = ?1').bind(id, ff).run(); } catch (e) {}
    }
    // 재참여 설문(migrations/0014)도 batch 밖에서: 원격에 0014 가 없어도 신청자 행은 남고 설문은 KV 정본에만
    if (sv && dbOk) {
      try { await env.DB.prepare('UPDATE submissions SET survey = ?2 WHERE application_id = ?1').bind(id, JSON.stringify(sv.survey)).run(); } catch (e) {}
    }
    // 트랙/직장인 문항(migrations/0008)도 batch 밖에서: 원격에 0008 이 없어도 신청자 행은 남음
    if (form && dbOk) {
      try {
        await env.DB.prepare('UPDATE submissions SET track = ?2, schedule_pref = ?3 WHERE application_id = ?1')
          .bind(id, form.track || '', f.schedule_pref || '').run();
      } catch (e) {}
    }
    if (!kvOk && !dbOk) return json({ ok: false, error: 'store failed' }, 500);
    // Lead 는 서버가 전화번호 해시(82 국가번호), 성별까지 붙여 보냄. 브라우저 픽셀 Lead 와 lead_eid 로 합쳐짐
    if (form && !reviewOnly) {   // 후기만은 신청이 아니라 Lead 를 안 보냄
      const d = normPhone(f.phone), ph = /^0\d{9,10}$/.test(d) ? '82' + d.slice(1) : '';
      const user = { country: [await sha256('kr')] };
      if (ph) user.ph = [await sha256(ph)];
      if (f.gender === '여성' || f.gender === '남성') user.ge = [await sha256(f.gender === '여성' ? 'f' : 'm')];
      // 알림 신청(lite, 10/11)은 신청이 아니라서 Lead 대신 AlertSignup (메타 리드/최적화에 안 섞이게). 브라우저 픽셀도 같은 이름, 같은 eventID
      const evName = form.lite ? 'AlertSignup' : 'Lead';
      waitUntil(capiEvent(request, b, evName, b.lead_eid, user, { channel: h.utm_content || h.src || 'direct', city: h.city || '', content_name: h.utm_content || h.src || 'direct', content_category: form.lite ? 'alert' : form.plan === 'prealert' ? 'prealert' : 'paid' }).then((ev) => capiSend(env, ev)));
    }
    return json({ ok: true, id, application_id: id });
  }

  if (request.method === 'GET' && (path === '/export' || path === '/stats')) {
    // 읽기는 READ_TOKEN(시트 IMPORTDATA 용, 읽기 전용) 또는 EXPORT_TOKEN(관리자) 둘 다 허용. 삭제는 EXPORT_TOKEN 만
    const token = url.searchParams.get('token') || '';
    const okRead = (env.READ_TOKEN && token === env.READ_TOKEN) || (env.EXPORT_TOKEN && token === env.EXPORT_TOKEN);
    if (!okRead) return json({ error: 'unauthorized' }, 401);
    const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    // 새 자유 입력 열(학과)은 시트가 수식으로 읽지 않게 = + - @ 로 시작하면 앞에 ' 를 붙임. 기존 열 값은 그대로 둠
    const escFree = (v) => esc(v != null && /^[=+\-@\t\r]/.test(String(v)) ? "'" + v : v);
    const csv = (lines) => new Response('﻿' + lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });

    if (path === '/stats') {
      const r = await env.DB.prepare(`SELECT COUNT(*) landed, SUM(started) started, SUM(max_page >= 2 OR submitted) page1_done FROM sessions WHERE is_bot = 0 AND path <> '/'`).first();
      const subs = await env.DB.prepare('SELECT COUNT(*) n FROM submissions').first();
      const by = await env.DB.prepare(`SELECT COALESCE(channel,'(없음)') k, COUNT(*) landed, SUM(started) started, SUM(max_page >= 2 OR submitted) page1_done, SUM(submitted) submitted FROM sessions WHERE is_bot = 0 AND path <> '/' GROUP BY k`).all();
      const drop = await env.DB.prepare(`SELECT COALESCE(NULLIF(last_field,''),'(없음)') k, COUNT(*) n FROM sessions WHERE is_bot = 0 AND started = 1 AND submitted = 0 AND path <> '/' GROUP BY k`).all();
      const bySource = {}; for (const x of by.results) bySource[x.k] = { landed: x.landed, started: x.started || 0, page1_done: x.page1_done || 0, submitted: x.submitted || 0 };
      const dropped = {}; for (const x of drop.results) dropped[x.k] = x.n;
      return json({ total: { landed: r.landed || 0, started: r.started || 0, page1_done: r.page1_done || 0, submitted: subs.n || 0 }, by_source: bySource, dropped_at_last_field: dropped });
    }
    if (url.searchParams.get('type') === 'partials') {
      const rows = (await env.DB.prepare(`SELECT * FROM sessions WHERE is_bot = 0 AND path <> '/' ORDER BY first_ts`).all()).results;
      if (url.searchParams.get('format') === 'json') return json(rows);
      const head = ['sid', 'status', 'first_at', 'last_at', 'page', 'last_field', ...BASE_FIELDS, 'src', 'channel', 'city', 'path', 'active_sec', 'device', 'in_app', 'ref', ...FESTIVAL_FIELDS, ...WORK_FIELDS];
      const lines = [head.join(',')];
      for (const r of rows) {
        const f = r.fields ? JSON.parse(r.fields) : {};
        lines.push([r.sid, r.submitted ? 'submitted' : r.started ? 'partial' : 'landed', KST(r.first_ts), KST(r.last_ts), r.max_page, r.last_field, ...BASE_FIELDS.map((k) => f[k]), r.src, r.channel, r.city, r.path, Math.round((r.active_ms || 0) / 1000), r.device, r.in_app, r.ref].map(esc)
          .concat(FESTIVAL_FIELDS.map((k) => escFree(f[k]))).concat(WORK_FIELDS.map((k) => esc(f[k]))).join(','));
      }
      return csv(lines);
    }
    // 제출: 정본 KV
    const rows = [];
    let cursor;
    do {
      const l = await kv.list({ prefix: 's:', cursor, limit: 1000 });
      for (const k of l.keys) { const v = await kv.get(k.name, 'json'); if (v) rows.push(v); }
      cursor = l.list_complete ? undefined : l.cursor;
    } while (cursor);
    rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (url.searchParams.get('format') === 'json') return json(rows);
    const head = ['application_id', 'submitted_at', ...BASE_FIELDS, 'phone_digits', ...HIDDEN, 'ref', 'sid', ...FESTIVAL_FIELDS, ...WORK_FIELDS, 'track'];
    const lines = [head.join(',')];
    for (const r of rows) {
      const f = r.fields || {}, h = r.hidden || {};
      lines.push([r.application_id || r.id, r.submitted_at, ...BASE_FIELDS.map((k) => f[k]), r.phone_digits, ...HIDDEN.map((k) => h[k]), r.ref, r.sid].map(esc)
        .concat(FESTIVAL_FIELDS.map((k) => escFree(f[k]))).concat(WORK_FIELDS.map((k) => esc(f[k]))).concat([esc(r.track || '')]).join(','));
    }
    return csv(lines);
  }

  // 테스트 데이터 정리용. DELETE /api/records?token=..&key=s:xxx  또는  &all=1&confirm=YES (전부 삭제)
  if (request.method === 'DELETE' && path === '/records') {
    const token = url.searchParams.get('token') || '';
    if (!env.EXPORT_TOKEN || token !== env.EXPORT_TOKEN) return json({ error: 'unauthorized' }, 401);
    const key = url.searchParams.get('key');
    if (key && /^s:/.test(key)) {
      const orig = await kv.get(key, 'json').catch(() => null);
      await kv.delete(key);
      if (orig && (orig.application_id || orig.id)) await kv.delete('img:' + (orig.application_id || orig.id));
      if (env.DB) await env.DB.prepare('DELETE FROM submissions WHERE kv_key = ?1').bind(key).run();
      return json({ ok: true, deleted: [key] });
    }
    if (url.searchParams.get('all') === '1' && url.searchParams.get('confirm') === 'YES') {
      const deleted = [];
      for (const prefix of ['s:', 'p:', 'm:', 'img:']) {
        let cursor;
        do {
          const l = await kv.list({ prefix, cursor, limit: 1000 });
          for (const k of l.keys) { await kv.delete(k.name); deleted.push(k.name); }
          cursor = l.list_complete ? undefined : l.cursor;
        } while (cursor);
      }
      if (env.DB) await env.DB.batch([env.DB.prepare('DELETE FROM submissions'), env.DB.prepare('DELETE FROM sessions')]);
      return json({ ok: true, deleted });
    }
    return json({ error: 'key 또는 all=1&confirm=YES 필요' }, 400);
  }

  if (path.startsWith('/admin/')) return admin(path.slice(6), request, env, kv, url);

  return json({ error: 'not found' }, 404);
}

// ---- 관리 페이지 (/admin) ----
const COOKIE = 'hh_admin';
const SESSION_DAYS = 7;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
function sameStr(a, b) {
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function sessionOk(request, env) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(COOKIE + '=([^;]+)'));
  if (!m || !env.ADMIN_SESSION_SECRET) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameStr(sig, await hmac(env.ADMIN_SESSION_SECRET, exp));
}

// 기간/필터 → WHERE 절. 봇은 항상 제외
function filters(url, alias = '') {
  const a = alias ? alias + '.' : '';
  const w = [`${a}is_bot = 0`], args = [];
  const from = Number(url.searchParams.get('from')) || 0, to = Number(url.searchParams.get('to')) || 0;
  if (from) { args.push(from); w.push(`${a}first_ts >= ?${args.length}`); }
  if (to) { args.push(to); w.push(`${a}first_ts < ?${args.length}`); }
  const p = url.searchParams.get('path'); if (p) { args.push(p); w.push(`${a}path = ?${args.length}`); }
  // paths=경로,경로,… : 기수 단위로 볼 때(등록부에서 그 기수의 경로 목록을 클라가 보냄). path 와 같이 오면 path 우선
  const ps = url.searchParams.get('paths');
  if (!p && ps) {
    const list = ps.split(',').map((x) => x.trim()).filter((x) => /^[\w\-\/.]+$/.test(x)).slice(0, 40);
    const cond = [];
    if (list.length) { const ph = list.map((x) => { args.push(x); return `?${args.length}`; }); cond.push(`${a}path IN (${ph.join(', ')})`); }
    // land=경로,… + land_from/land_to : 랜딩(/ 등)은 기수 공용이라 그 기수 모집 기간(직전 기수 마감 ~ 이 기수 마감) 방문만 셈
    const land = (url.searchParams.get('land') || '').split(',').map((x) => x.trim()).filter((x) => /^[\w\-\/.]+$/.test(x)).slice(0, 10);
    if (land.length) {
      const lc = [`${a}path IN (${land.map((x) => { args.push(x); return `?${args.length}`; }).join(', ')})`];
      const lf = Number(url.searchParams.get('land_from')) || 0, lt = Number(url.searchParams.get('land_to')) || 0;
      if (lf) { args.push(lf); lc.push(`${a}first_ts >= ?${args.length}`); }
      if (lt) { args.push(lt); lc.push(`${a}first_ts < ?${args.length}`); }
      cond.push(`(${lc.join(' AND ')})`);
    }
    if (cond.length) w.push(`(${cond.join(' OR ')})`);
  }
  const s = url.searchParams.get('src'); if (s) { if (s === '(없음)') w.push(`${a}src IS NULL`); else { args.push(s); w.push(`${a}src = ?${args.length}`); } }
  return { where: w.join(' AND '), args };
}
// 랜딩 경로를 서브쿼리로 두면 sessions 행마다 forms 를 다시 읽어 D1 읽기 한도를 먹음 → 먼저 한 번 읽어 리터럴로 박음
async function landExpr(DB) {
  const r = await DB.prepare(`SELECT path FROM forms WHERE kind = 'landing'`).all();
  const paths = ['/', ...r.results.map((x) => x.path)].filter((x) => /^[\w\-\/.]+$/.test(x));
  return `(path IN (${paths.map((x) => `'${x}'`).join(', ')}))`;
}
// 사람 단위 퍼널 (10/13): 같은 사람의 여러 방문(인앱 브라우저는 광고를 누를 때마다 새 sid)을 한 사람으로 묶고, 시험 입력은 뺌.
// 묶는 고리 = 기기 id(did) / 전화번호 / 성별+출생년도+학교. 단계는 그 사람이 간 가장 먼 단계로 셈(그 단계 이후까지 간 사람)
// 단계: 1 도착, 2 스크롤 25%, 3 입력 시작, 4 1페이지 완료, 5 2페이지 완료, 6 송금 버튼(계좌 복사 포함), 7 제출. 2페이지짜리 폼은 5 = 제출과 같음
const TEST_PHONE = '40658416';
const isTestSchool = (x) => /테스트|^111$/.test(String(x || '').trim());
async function personFunnel(DB, where, args, LAND) {
  const cols = (extra) => `SELECT sid, first_ts, submitted, started, max_page, max_scroll, last_field, is_return${extra},
      json_extract(fields, '$.phone') ph, json_extract(fields, '$.gender') g, json_extract(fields, '$.birth_year') byr, json_extract(fields, '$.school') sc
    FROM sessions WHERE ${where} AND NOT ${LAND}`;
  let rows;
  try { rows = (await DB.prepare(cols(', did, pay')).bind(...args).all()).results; }
  catch (e) { rows = (await DB.prepare(cols(', NULL did, 0 pay')).bind(...args).all()).results; }   // 0012 적용 전
  const up = new Map(), find = (x) => { while (up.get(x) !== x) { up.set(x, up.get(up.get(x))); x = up.get(x); } return x; };
  const add = (x) => { if (!up.has(x)) up.set(x, x); return find(x); };
  const join = (a, b) => { const ra = add(a), rb = add(b); if (ra !== rb) up.set(ra, rb); };
  rows.forEach((r) => {
    const me = 's:' + r.sid; add(me);
    if (r.did) join(me, 'd:' + r.did);
    const ph = String(r.ph || '').replace(/\D/g, ''); if (ph.length >= 10) join(me, 'p:' + ph);
    if (r.g && r.byr && r.sc) join(me, 'f:' + r.g + '|' + r.byr + '|' + String(r.sc).trim());
    r.test = String(r.ph || '').replace(/\D/g, '').includes(TEST_PHONE) || isTestSchool(r.sc);
    r.lv = r.submitted ? 7 : (r.pay || r.last_field === 'pay_click') ? 6 : r.max_page >= 3 ? 5 : r.max_page >= 2 ? 4 : r.started ? 3 : r.max_scroll >= 25 ? 2 : 1;
  });
  const P = new Map();
  let merged = 0;
  rows.forEach((r) => {
    // 기기 id 가 없던 기록(0012 전): 다시 온 기기(is_return)의 입력 없는 방문은 앞 방문과 같은 사람으로 보고 뺌
    if (!r.did && r.is_return && r.lv <= 2 && find('s:' + r.sid) === 's:' + r.sid) { merged++; return; }
    const k = find('s:' + r.sid), p = P.get(k) || { lv: 0, t: Infinity, test: false };
    p.lv = Math.max(p.lv, r.lv); p.t = Math.min(p.t, r.first_ts); p.test = p.test || r.test; P.set(k, p);
  });
  const total = [0, 0, 0, 0, 0, 0, 0], by = {};
  let tests = 0;
  P.forEach((p) => {
    if (p.test) { tests++; return; }
    const d = new Date(p.t + 9 * 3600e3).toISOString().slice(0, 10), row = by[d] || (by[d] = [0, 0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < p.lv; i++) { total[i]++; row[i]++; }
  });
  return { total, by_day: by, tests, merged, sessions: rows.length };
}
const METRICS = `COUNT(*) visits,
  SUM(started) starts,
  SUM(max_page >= 2 OR submitted) page2,
  SUM(max_page >= 3 OR submitted) page3,
  SUM(submitted) submits,
  SUM(CASE WHEN started = 1 AND submitted = 0 THEN 1 ELSE 0 END) partials,
  SUM(CASE WHEN started = 0 AND submitted = 0 AND next_click IS NULL THEN 1 ELSE 0 END) bounces,
  SUM(CASE WHEN next_click IS NOT NULL THEN 1 ELSE 0 END) next_clicks,
  AVG(NULLIF(active_ms, 0)) avg_active_ms,
  SUM(active_ms > 0) active_n,
  AVG(CASE WHEN submitted = 1 THEN submitted_ts - first_ts END) avg_submit_ms,
  SUM(is_return) returns,
  MAX(first_ts) last_visit`;

// 지표/링크 조회는 sessions 전체를 훑어 D1 읽기 한도(무료 하루 5M 행)를 먹음 → 같은 조회는 KV 에 15분 캐시.
// 새로고침을 아무리 눌러도 D1 은 15분에 한 번만 읽음. 신청자 목록은 가벼워서 캐시 안 함(항상 최신)
const CACHE_SEC = 900;
// 키에 meta:cache_ver 를 넣어 폼/링크를 저장하면 그 즉시 새 키로 다시 읽음. 응답의 cached_at 은 그 지표가 D1 에서 읽힌 시각
async function cached(kv, key, fn) {
  const ver = (await kv.get('meta:cache_ver').catch(() => '')) || '0';
  key = key + ':' + ver;
  try { const hit = await kv.get(key, 'json'); if (hit) return json(hit); } catch (e) {}
  const out = await fn();
  out.cached_at = Date.now();
  try { await kv.put(key, JSON.stringify(out), { expirationTtl: CACHE_SEC }); } catch (e) {}
  return json(out);
}
async function bumpCache(kv) { try { await kv.put('meta:cache_ver', String(Date.now())); } catch (e) {} }

async function admin(sub, request, env, kv, url) {
  if (request.method === 'POST' && sub === '/login') {
    if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({ ok: false, error: '관리 비밀번호 미설정' }, 500);
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    const rlKey = 'rl:' + ip;
    const fails = Number(await kv.get(rlKey)) || 0;
    if (fails >= 5) return json({ ok: false, error: '시도가 너무 많음. 10분 뒤 다시' }, 429);
    const b = await readBody(request);
    if (!b || !sameStr(b.password, env.ADMIN_PASSWORD)) {
      await kv.put(rlKey, String(fails + 1), { expirationTtl: 600 });
      return json({ ok: false, error: '비밀번호가 틀림' }, 401);
    }
    const exp = String(Date.now() + SESSION_DAYS * 86400 * 1000);
    const val = exp + '.' + (await hmac(env.ADMIN_SESSION_SECRET, exp));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=${val}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}` } });
  }
  if (request.method === 'POST' && sub === '/logout') {
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } });
  }
  if (!(await sessionOk(request, env))) return json({ error: 'unauthorized' }, 401);
  // 학생 인증 캡처 보기 (관리자 로그인 쿠키가 있어야만). 신청ID 로 KV img:{신청ID} 를 그대로 내려줌
  if (request.method === 'GET' && sub === '/capture') {
    const id = url.searchParams.get('id') || '';
    if (!/^[0-9a-z-]{8,64}$/i.test(id)) return json({ error: 'bad id' }, 400);
    const got = await kv.getWithMetadata('img:' + id, 'arrayBuffer');
    if (!got || !got.value) return json({ error: 'not found' }, 404);
    const type = sniffImage(new Uint8Array(got.value));
    if (!type) return json({ error: 'not an image' }, 415);
    // 학생증 캡처라 브라우저 캐시에도 남기지 않음 (삭제, 로그아웃 뒤에 캐시로 다시 보이지 않게)
    return new Response(got.value, { headers: { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline' } });
  }
  const DB = env.DB;
  if (!DB) return json({ error: 'D1 binding missing' }, 500);

  if (request.method === 'GET' && sub === '/ping') {
    const last = await DB.prepare('SELECT MAX(last_ts) t FROM sessions').first();
    return json({ last_submit: Number(await kv.get('meta:last_submit')) || 0, last_activity: (last && last.t) || 0 });
  }

  // 지표 한 번에: 합계, 일별, 시간대별, 폼별, 링크별, 이탈 문항, 기기/인앱
  if (request.method === 'GET' && sub === '/analytics') return cached(kv, 'cache:analytics:' + url.search, async () => {
    const { where, args } = filters(url);
    const LAND = await landExpr(DB);
    const q = (sql) => DB.prepare(sql).bind(...args);
    const [tot, day, hour, form, src, drop, dev, app, fset] = await DB.batch([
      q(`SELECT ${METRICS} FROM sessions WHERE ${where}`),
      q(`SELECT date((first_ts / 1000) + 32400, 'unixepoch') k,
          SUM(${LAND}) land, SUM(${LAND} AND next_click IS NOT NULL) land_click,
          SUM(NOT ${LAND}) visits, SUM(NOT ${LAND} AND started = 1) starts, SUM(NOT ${LAND} AND (max_page >= 2 OR submitted = 1)) page2, SUM(NOT ${LAND} AND (max_page >= 3 OR submitted = 1)) page3,
          SUM(NOT ${LAND} AND submitted = 1) submits, SUM(NOT ${LAND} AND started = 1 AND submitted = 0) partials,
          AVG(CASE WHEN NOT ${LAND} THEN NULLIF(active_ms, 0) END) avg_active_ms
        FROM sessions WHERE ${where} GROUP BY k ORDER BY k`),
      q(`SELECT CAST(strftime('%H', (first_ts / 1000) + 32400, 'unixepoch') AS INTEGER) k, COUNT(*) visits, SUM(submitted) submits FROM sessions WHERE ${where} GROUP BY k`),
      q(`SELECT path k, ${METRICS} FROM sessions WHERE ${where} GROUP BY k`),
      // 링크별: 한 사람이 랜딩 → 폼으로 가면 행이 2개라 방문은 sid 기준으로 셈
      q(`SELECT COALESCE(src, '(없음)') k, COUNT(DISTINCT sid) visits, SUM(started) starts, SUM(max_page >= 2 OR submitted) page2, SUM(max_page >= 3 OR submitted) page3, SUM(submitted) submits,
          SUM(CASE WHEN started = 1 AND submitted = 0 THEN 1 ELSE 0 END) partials, AVG(CASE WHEN NOT ${LAND} THEN NULLIF(active_ms, 0) END) avg_active_ms, MAX(first_ts) last_visit
        FROM sessions WHERE ${where} GROUP BY k ORDER BY visits DESC`),
      q(`SELECT path, COALESCE(NULLIF(last_field, ''), '(없음)') k, max_page, COUNT(*) n FROM sessions WHERE ${where} AND started = 1 AND submitted = 0 GROUP BY path, k, max_page ORDER BY n DESC`),
      q(`SELECT device k, COUNT(*) visits, SUM(submitted) submits FROM sessions WHERE ${where} GROUP BY k ORDER BY visits DESC`),
      q(`SELECT COALESCE(NULLIF(in_app, ''), '일반 브라우저') k, COUNT(*) visits, SUM(submitted) submits FROM sessions WHERE ${where} GROUP BY k ORDER BY visits DESC`),
      DB.prepare('SELECT * FROM forms ORDER BY kind DESC, created_at'),
    ]);
    const people = await personFunnel(DB, where, args, LAND);
    // 봇 수 COUNT 는 is_bot 인덱스가 없어 전체 스캔(하루 1M 행) → 뺌. 봇은 어차피 WHERE 에서 제외됨
    return { people, total: tot.results[0], by_day: day.results, by_hour: hour.results, by_form: form.results, by_src: src.results, drop: drop.results, by_device: dev.results, by_app: app.results, forms: fset.results, bots: 0 };
  });

  // 방문 로그: state = all | bounce | partial | submitted
  if (request.method === 'GET' && sub === '/sessions') {
    const { where, args } = filters(url);
    const st = url.searchParams.get('state');
    const extra = st === 'partial' ? ' AND started = 1 AND submitted = 0' : st === 'submitted' ? ' AND submitted = 1' : st === 'bounce' ? ' AND started = 0 AND submitted = 0' : '';
    const lim = Math.min(Number(url.searchParams.get('limit')) || 300, 2000);
    const rows = await DB.prepare(`SELECT sid, path, city, src, channel, utm_campaign, utm_content, ref, device, in_app, is_return, first_ts, last_ts, active_ms, max_scroll, started, max_page, last_field, fields, filled, next_click, submitted, submitted_ts, application_id
      FROM sessions WHERE ${where}${extra} ORDER BY first_ts DESC LIMIT ${lim}`).bind(...args).all();
    return json({ rows: rows.results });
  }

  // 신청자 (D1 사본 + 처리 상태)
  if (request.method === 'GET' && sub === '/applicants') {
    const rows = await DB.prepare(`SELECT s.*, x.active_ms, x.device ua_device, x.in_app FROM submissions s LEFT JOIN sessions x ON x.application_id = s.application_id ORDER BY s.submitted_ts DESC`).all();
    return json({ rows: rows.results, last_submit: Number(await kv.get('meta:last_submit')) || 0 });
  }
  if (request.method === 'DELETE' && sub === '/applicants') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'forbidden' }, 403);
    const b = await readBody(request);
    if (!b || typeof b.id !== 'string' || !/^[0-9a-z-]{8,64}$/i.test(b.id) || b.confirm !== b.id) {
      return json({ error: '삭제할 신청자 한 명을 확인해 주세요.' }, 400);
    }
    const row = await DB.prepare('SELECT application_id, kv_key FROM submissions WHERE application_id = ?1').bind(b.id).first();
    if (!row) return json({ error: '이미 삭제되었거나 없는 신청자입니다.' }, 404);
    if (!row.kv_key || !row.kv_key.startsWith('s:')) return json({ error: '원본 정보를 확인할 수 없어 삭제하지 않았습니다.' }, 409);
    try {
      const original = await kv.get(row.kv_key, 'json');
      if (original && (original.application_id || original.id) !== b.id) return json({ error: '원본 정보가 일치하지 않아 삭제하지 않았습니다.' }, 409);
      // Keep the D1 row until KV cleanup succeeds so interrupted deletions can be retried.
      await kv.delete(row.kv_key);
      await kv.delete('m:' + b.id);
      await kv.delete('img:' + b.id); // 전남대 축제 학생 인증 캡처 (없으면 아무 일 없음)
      await DB.batch([
        DB.prepare('DELETE FROM sessions WHERE application_id = ?1').bind(b.id),
        DB.prepare('DELETE FROM submissions WHERE application_id = ?1').bind(b.id),
      ]);
      return json({ ok: true, deleted: b.id });
    } catch (e) {
      return json({ error: '삭제를 완료하지 못했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.' }, 500);
    }
  }
  if (request.method === 'POST' && sub === '/mark') {
    const b = await readBody(request);
    if (!b || typeof b.id !== 'string' || !/^[0-9a-z-]{8,64}$/i.test(b.id)) return json({ ok: false }, 400);
    const now = KST(Date.now());
    // room: 확정한 사람의 방 기록 (예: 서울방1). 안 보내면 기존 값 유지
    await DB.prepare('UPDATE submissions SET status = ?2, memo = ?3, status_updated_at = ?4, room = COALESCE(?5, room), buddy = COALESCE(?6, buddy), buddy_room = COALESCE(?7, buddy_room) WHERE application_id = ?1')
      .bind(b.id, String(b.status || '').slice(0, 20), String(b.memo || '').slice(0, 500), now, typeof b.room === 'string' ? b.room.slice(0, 40) : null,
        typeof b.buddy === 'string' ? buddyVal(b.buddy.slice(0, 40)) : null, typeof b.buddy_room === 'string' ? b.buddy_room.slice(0, 20) : null).run();
    return json({ ok: true, updated_at: now });
  }

  // 폼 목록/이름 변경/보관
  if (sub === '/forms') {
    if (request.method === 'POST') {
      const b = await readBody(request);
      if (!b || typeof b.path !== 'string') return json({ ok: false }, 400);
      await DB.prepare(`INSERT INTO forms (path, name, kind, city, archived, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(path) DO UPDATE SET name = excluded.name, kind = excluded.kind, city = excluded.city, archived = excluded.archived`)
        .bind(normPath(b.path), String(b.name || b.path).slice(0, 60), b.kind === 'landing' ? 'landing' : 'form', b.city || null, b.archived ? 1 : 0, Date.now()).run();
      await bumpCache(kv); // 폼 이름/종류 바꾼 게 지표 캐시에 가려지지 않게
      return json({ ok: true });
    }
    return json({ rows: (await DB.prepare('SELECT * FROM forms ORDER BY kind DESC, created_at').all()).results });
  }

  // 링크(src) 등록부 + 트래픽에서만 보이는 미등록 src
  if (sub === '/links') {
    if (request.method === 'POST') {
      const b = await readBody(request);
      if (!b || typeof b.src !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(b.src)) return json({ ok: false, error: 'src 는 영문/숫자/-/_ 만' }, 400);
      await DB.prepare(`INSERT INTO links (src, path, label, channel, note, archived, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(src) DO UPDATE SET path = excluded.path, label = excluded.label, channel = excluded.channel, note = excluded.note, archived = excluded.archived`)
        .bind(b.src, normPath(b.path), String(b.label || '').slice(0, 80), String(b.channel || '').slice(0, 30), String(b.note || '').slice(0, 300), b.archived ? 1 : 0, Date.now()).run();
      await bumpCache(kv); // 링크 저장 직후 목록이 캐시에 가려지지 않게
      return json({ ok: true });
    }
    const { where, args } = filters(url, 's');
    return cached(kv, 'cache:links:' + url.search, async () => {
      const rows = await DB.prepare(`SELECT l.src, l.path, l.label, l.channel, l.note, l.archived, l.created_at, 1 registered FROM links l
        UNION SELECT DISTINCT s.src, s.path, NULL, NULL, NULL, 0, MIN(s.first_ts), 0 FROM sessions s WHERE ${where} AND s.src IS NOT NULL AND s.src NOT IN (SELECT src FROM links) GROUP BY s.src`).bind(...args).all();
      return { rows: rows.results };
    });
  }
  return json({ error: 'not found' }, 404);
}
