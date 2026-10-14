// 폼 등록부 — 경로 하나에 기수/트랙/요금제/금액/마감이 전부. 서버(/api), build.sh, 관리 페이지가 전부 여기서 읽음.
// 새 기수는 아래에 줄 추가 + CURRENT_COHORT 변경으로 끝. 지난 기수 줄은 지우지 않음 (옛 링크는 마감 안내 + 현재 기수 폼으로 안내).
// 경로 규칙 /{기수}/{트랙}/{요금제}/ (3기는 옛 경로 그대로 둠). 요금제(plan) 4값: regular 정가 / discount 할인(메시지로만 보냄) / prealert 무료 사전알림 / early(3기 전용, 시간 제한 할인)
// 성별은 트랙이 아니라 문항. 세트는 광고에서 나뉨.

export const CURRENT_COHORT = '5';

// 기수 마감 (KST). 지나면 그 기수 폼 전부 + 지역 선택이 마감 안내로 바뀌고 /api/submit 도 409 cohort_closed 로 거부
export const COHORT_DEADLINES = {
  '3': '2026-10-06T00:00:00+09:00', // 신청 마감 10/5(월) 밤
  '4': '2026-10-10T17:00:00+09:00', // 10/10 사용자: 직장인 사전알림 빼고 지금 닫고 5기로 이어지게 (원래 10/11 00:00). 진행 10/11(일)~10/13(화)
  '5': '2026-10-14T18:00:00+09:00', // 신청 마감 10/14(수) 18:00. 진행 10/15(목)~10/17(토) (10/10 사용자)
  '6': '2026-10-18T18:00:00+09:00', // 진행 10/19(월)~10/21(수) (10/14 사용자). 마감은 5기처럼 시작 전날 18:00 (가안)
};
export const COHORT_DEADLINE_KO = { '3': '10월 5일(월)', '4': '10월 10일(토)', '5': '10월 14일(수) 18:00', '6': '10월 18일(일) 18:00' };

const PAY = 'https://haruharu-pay.pages.dev';
// 친구 할인 (10/8~, 개선판 정가 폼): 친구와 서로 번호를 적고 신청하면 둘 다 2,000원 할인. friendFee 는 할인된 금액, friendPay 는 그 금액의 송금 페이지(haruharu-pay /b/).
//   이 두 값이 있는 폼만 대상. 판정은 shared/friend-discount.mjs
const FRIEND = { friendFee: 5900, friendPay: PAY + '/b/' };
// 정가 표시 (10/8~, 개선판 정가 폼): 참가비 안내에서 이 금액에 줄을 긋고 실제 참가비 앞에 보여 줌. 3기 안내 그림(P4 ..._12900)과 축제 폼이 써 온 값. 표시만 하고 계산에는 안 씀
const LIST = { listFee: 12900 };
// 3기 공통값 (옛 경로, 값 바꾸지 않음)
const S3 = { cohort: '3', city: 'seoul', track: 'seoul-student', trackKo: '서울 학생', cityKo: '서울', schoolEx: '서울대학교' };
const G3 = { cohort: '3', city: 'gwangju', track: 'gwangju-student', trackKo: '광주 학생', cityKo: '광주', schoolEx: '전남대학교' };
const S4 = { ...S3, cohort: '4' };
const G4 = { ...G3, cohort: '4' };
const S5 = { ...S3, cohort: '5' };
const G5 = { ...G3, cohort: '5' };
const S6 = { ...S3, cohort: '6' };
const REJOIN5 = { plan: 'discount', fee: 5900, pay: PAY + '/b/', ...LIST, landing: true, variant: 'v2', rejoin: true };
const W4 = { cohort: '4', city: 'seoul', track: 'seoul-work', trackKo: '수도권 직장인', cityKo: '수도권', occupation: true };  // city 키는 seoul 유지, 표기만 수도권 (10/6)

export const FORMS = {
  // ---- 3기 (마감됨. 링크는 살아 있고 마감 안내 + 4기 폼 버튼) ----
  '/seoul/':                { ...S3, plan: 'regular',  fee: 7900, pay: PAY + '/j/', label: '3기 서울 학생' },
  '/gwangju/':              { ...G3, plan: 'regular',  fee: 7900, pay: PAY + '/j/', label: '3기 광주 학생' },
  '/seoul/pre-4k9x/':       { ...S3, plan: 'early',    fee: 4900, pay: PAY + '/e/', label: '3기 서울 사전알림 할인' },
  '/gwangju/pre-4k9x/':     { ...G3, plan: 'early',    fee: 4900, pay: PAY + '/e/', label: '3기 광주 사전알림 할인' },
  '/seoul/discount-4900/':  { ...S3, plan: 'discount', fee: 4900, pay: PAY + '/e/', label: '3기 서울 할인' },
  '/gwangju/discount-4900/':{ ...G3, plan: 'discount', fee: 4900, pay: PAY + '/e/', label: '3기 광주 할인' },
  // 전남대 축제는 shared/jnu-festival.mjs 가 마감/캡처를 따로 봄. 여기엔 관리 페이지 라벨용으로만
  '/jnu-festival/':         { cohort: 'jnu-festival', city: 'gwangju', track: 'festival', trackKo: '전남대 축제', cityKo: '광주', plan: 'jnu_festival', fee: 4900, pay: PAY + '/f/', label: '전남대 축제', festival: true },

  // ---- 4기: 서울 학생 / 광주 학생 (유료 직행) + 수도권 직장인 (무료 사전알림 → 메시지로 할인 결제) ----
  '/4/seoul/':              { ...S4, plan: 'regular',  fee: 7900, pay: PAY + '/j/', label: '4기 서울 학생', listed: true, landing: true },
  '/4/gwangju/':            { ...G4, plan: 'regular',  fee: 7900, pay: PAY + '/j/', label: '4기 광주 학생', listed: true, landing: true },
  '/4/seoul/x7q2/':         { ...S4, plan: 'discount', fee: 4900, pay: PAY + '/e/', label: '4기 서울 학생 할인 (메시지 전용)', landing: true },
  '/4/gwangju/x7q2/':       { ...G4, plan: 'discount', fee: 4900, pay: PAY + '/e/', label: '4기 광주 학생 할인 (메시지 전용)', landing: true },
  '/4/seoul-work/pre/':     { ...W4, plan: 'prealert', fee: 0,    pay: '',          label: '4기 수도권 직장인 사전알림 (무료)', listed: true, landing: true, period: '10월 중순', noDeadline: true, entry: '/seoul/work/' },   // 10/10: 4기 마감 뒤에도 그대로 받음 (사용자)  // 일정 미확정이라 학생 4기 일정 대신 (10/7)
  '/4/seoul-work/x7q2/':    { ...W4, plan: 'discount', fee: 4900, pay: PAY + '/e/', label: '4기 수도권 직장인 할인 (사전알림 메시지 전용)', landing: true },
  '/4/seoul-work/':         { ...W4, plan: 'regular',  fee: 7900, pay: PAY + '/j/', label: '4기 수도권 직장인', landing: true },
  // 개선판 (10/8~): 기존 폼은 그대로 두고 새 주소에 나란히 올림. 이름은 '기존 이름 - 개선'. 화면은 build-v2.sh 가 src/form.v2.template.html + src/landing.v2.html 로 만듦.
  //   지역 선택(/)에는 안 보임(listed 없음). 남녀 화면은 주소 끝 ?g=f / ?g=m. variant 가 있는 줄은 build.sh 의 기존 빌드와 '같은 트랙 정가 폼 찾기'에서 빠짐
  '/4/seoul/v2/':           { ...S4, plan: 'regular',  fee: 7900, pay: PAY + '/j/', ...FRIEND, ...LIST, label: '4기 서울 학생 - 개선', landing: true, variant: 'v2' },
  '/4/gwangju/v2/':         { ...G4, plan: 'regular',  fee: 7900, pay: PAY + '/j/', ...FRIEND, ...LIST, label: '4기 광주 학생 - 개선', landing: true, variant: 'v2' },
  '/4/seoul-work/pre/v2/':  { ...W4, plan: 'prealert', fee: 0,    pay: '',          label: '4기 수도권 직장인 사전알림 (무료) - 개선', landing: true, variant: 'v2', period: '10월 중순', noDeadline: true },
  // 재참여 (개선판 학생 폼 기반): 본인과 초대한 친구 모두 4,900원 고정. 공유는 같은 폼, 추가 친구 할인 없음.
  '/4/seoul/rejoin/':       { ...S4, plan: 'discount', fee: 4900, pay: PAY + '/e/', ...LIST, label: '4기 서울 학생 재참여', landing: true, variant: 'v2', rejoin: true },
  '/4/gwangju/rejoin/':     { ...G4, plan: 'discount', fee: 4900, pay: PAY + '/e/', ...LIST, label: '4기 광주 학생 재참여', landing: true, variant: 'v2', rejoin: true },

  // ---- 5기 (10/10~): 서울 학생 / 광주 학생 정가 폼 하나씩. 화면은 4기 A/B 에서 이긴 개선판(B) 그대로 (variant 'v2' = build-v2.sh 로 만든다는 뜻)
  // 10/12 사용자: 5기 서울/광주 폼을 새 랜딩(landingV3, src/landing.v3.html)과 2페이지(twoPage)로 교체. 주소/광고 링크/서버는 그대로. 남녀는 ?g=f / ?g=m (광고 src 로 자동 판별)
  // 10/13 (#41): twoPage → phonePage. 2페이지 = 전화번호+동의, 3페이지 = 참가비+계좌 복사+친구 접기. 10/13 전 화면으로 되돌리려면 phonePage 를 twoPage 로
  // 10/14 사용자: marketing = 동의 문항을 [모두 동의] + (필수) 개인정보 + (선택) 할인, 모집 소식 문자 받기 로. 쓰다 나간 사람에게 문자를 보낼 근거
  '/5/seoul/':              { ...S5, plan: 'regular',  fee: 7900, pay: PAY + '/j/', ...FRIEND, ...LIST, label: '5기 서울 학생', listed: true, feeFirst: true, landing: true, variant: 'v2', landingV3: true, phonePage: true, marketing: true, entry: '/seoul/student/', alert: '/alert/seoul/' },
  '/5/gwangju/':            { ...G5, plan: 'regular',  fee: 7900, pay: PAY + '/j/', ...FRIEND, ...LIST, label: '5기 광주 학생', listed: true, feeFirst: true, landing: true, variant: 'v2', landingV3: true, phonePage: true, marketing: true, entry: '/gwangju/student/' },

  // 5기 재참여 (10/11~, 메시지로만 보냄): 지난 참가자는 전화번호만 적음(phoneOnly). 성별/출생년도/학교는 서버가 같은 번호의 지난 신청에서 가져옴.
  //   친구에게 보내는 링크는 기본 문항이 있는 친구 초대 폼(friendForm)으로 열림. 둘 다 재참여 할인 5,900원 고정(송금 /b/), 추가 친구 할인 없음
  '/5/seoul/rejoin/':          { ...S5, ...REJOIN5, label: '5기 서울 학생 재참여', phoneOnly: true, friendForm: '/5/seoul/rejoin/friend/' },
  '/5/gwangju/rejoin/':        { ...G5, ...REJOIN5, label: '5기 광주 학생 재참여', phoneOnly: true, friendForm: '/5/gwangju/rejoin/friend/' },
  '/5/seoul/rejoin/friend/':   { ...S5, ...REJOIN5, label: '5기 서울 학생 재참여 친구 초대', invite: true },
  '/5/gwangju/rejoin/friend/': { ...G5, ...REJOIN5, label: '5기 광주 학생 재참여 친구 초대', invite: true },
  // 자정 마감 할인 (10/13, 메시지로만 보냄): 5기 폼을 쓰다 나간 사람에게 보내는 4,900원 폼. 10/13(화) 자정(= 10/14 00:00)에 이 폼만 닫힘(deadline, 기수 마감보다 이름).
  //   소개는 짧은 판(comeback, src/landing.comeback.html) + 남은 시간 표시. 문항은 5기 정가 폼과 같고 페이지를 나누지 않고 한 페이지에 전부(onePage, 10/13 운영자). 친구 할인은 없음. wasFee 는 줄 긋고 보여 주는 원래 참가비
  '/5/seoul/comeback/':     { ...S5, plan: 'discount', fee: 4900, pay: PAY + '/e/', wasFee: 7900, label: '5기 서울 학생 자정 마감 할인', feeFirst: true, landing: true, variant: 'v2', onePage: true, comeback: true, deadline: '2026-10-14T00:00:00+09:00', deadlineKo: '10월 13일(화) 자정' },
  '/5/gwangju/comeback/':   { ...G5, plan: 'discount', fee: 4900, pay: PAY + '/e/', wasFee: 7900, label: '5기 광주 학생 자정 마감 할인', feeFirst: true, landing: true, variant: 'v2', onePage: true, comeback: true, deadline: '2026-10-14T00:00:00+09:00', deadlineKo: '10월 13일(화) 자정' },
  // 낮 1시 마감 할인 (10/14, 메시지로만 보냄): 위 자정 마감 폼과 같은 화면, 주소와 마감만 다름. 10/14(수) 13:00 에 이 폼만 닫힘.
  //   noSource (10/14 운영자): [어디서 보고 오셨나요] [어떤 마음으로 신청하시나요] 두 문항을 뺌. 서버도 유입 경로를 필수로 안 봄
  //   untilKo / afterKo 는 첫 화면 글자(오늘 낮 1시까지만 / 1시가 지나면), 없으면 자정 문구
  '/5/seoul/lunch/':        { ...S5, plan: 'discount', fee: 4900, pay: PAY + '/e/', wasFee: 7900, label: '5기 서울 학생 낮 1시 마감 할인', feeFirst: true, landing: true, variant: 'v2', onePage: true, comeback: true, deadline: '2026-10-14T13:00:00+09:00', deadlineKo: '10월 14일(수) 낮 1시', untilKo: '오늘 낮 1시', afterKo: '1시가', noSource: true },
  '/5/gwangju/lunch/':      { ...G5, plan: 'discount', fee: 4900, pay: PAY + '/e/', wasFee: 7900, label: '5기 광주 학생 낮 1시 마감 할인', feeFirst: true, landing: true, variant: 'v2', onePage: true, comeback: true, deadline: '2026-10-14T13:00:00+09:00', deadlineKo: '10월 14일(수) 낮 1시', untilKo: '오늘 낮 1시', afterKo: '1시가', noSource: true },
  // 저녁 6시 마감 할인 (10/14): 같은 화면, 마감이 5기 마감(18:00)과 같음. 그래서 마감 뒤엔 기수 마감 안내(정가 폼 버튼 없음), 첫 화면 줄은 leftKo
  '/5/seoul/evening/':        { ...S5, plan: 'discount', fee: 4900, pay: PAY + '/e/', wasFee: 7900, label: '5기 서울 학생 저녁 6시 마감 할인', feeFirst: true, landing: true, variant: 'v2', onePage: true, comeback: true, deadline: '2026-10-14T18:00:00+09:00', deadlineKo: '10월 14일(수) 저녁 6시', untilKo: '오늘 저녁 6시', leftKo: '저녁 6시에 5기 신청이 마감돼요', noSource: true },
  '/5/gwangju/evening/':      { ...G5, plan: 'discount', fee: 4900, pay: PAY + '/e/', wasFee: 7900, label: '5기 광주 학생 저녁 6시 마감 할인', feeFirst: true, landing: true, variant: 'v2', onePage: true, comeback: true, deadline: '2026-10-14T18:00:00+09:00', deadlineKo: '10월 14일(수) 저녁 6시', untilKo: '오늘 저녁 6시', leftKo: '저녁 6시에 5기 신청이 마감돼요', noSource: true },
  // ---- 6기 (10/14~): 서울 학생 정가 폼 하나만 (광주 없음, 10/14 사용자). 화면/문항/금액은 5기 서울 폼 그대로.
  //   동의는 체크 하나 (10/14 사용자: [모두 동의] + 필수 + 선택 대신 하나로 통일 → marketing 끔)
  //   rate (10/14 사용자): 5기 모집 때처럼 매칭률 표기 (#48 에서 지운 것을 이 폼만 되살림, build-v2.sh)
  //   entry 를 안 달아서 고정 링크(/seoul/student/, 광고와 바이오)는 아직 6기로 안 넘어감 (10/14 사용자: 광고 url 은 그대로). 넘길 때 entry: '/seoul/student/' 추가 + CURRENT_COHORT '6'
  '/6/seoul/':              { ...S6, plan: 'regular',  fee: 7900, pay: PAY + '/j/', ...FRIEND, ...LIST, label: '6기 서울 학생', listed: true, feeFirst: true, landing: true, variant: 'v2', landingV3: true, phonePage: true, rate: true, alert: '/alert/seoul/' },
  // ---- 다음 기수 알림 (10/11~): 기수 폼의 [다음 기수 알림만] 칸이 이 경로로 제출함 (성별, 출생년도, 번호, 동의만 = lite).
  // 기수별로 안 나누고 한 통(cohort 'alert')으로 관리 (10/11 사용자), 관리 페이지 이름은 [알림 신청]. 경로 고정, 마감 없음, 화면 없음(build 대상 아님)
  '/alert/seoul/':          { ...S3, cohort: 'alert', plan: 'prealert', fee: 0, pay: '', label: '알림 신청 (서울 학생)', period: '추후 안내', noDeadline: true, noPage: true, lite: true },
};

// 고정 링크 (10/10~): 광고와 바이오는 이 주소만 씀. 서버(functions/{경로}/index.js)가 그때 열려 있는 기수 폼으로 302 (쿼리 그대로).
//   어느 폼으로 갈지는 등록부의 entry 값. 새 기수는 폼 줄에 같은 entry 를 달면 끝 → 앞 기수 마감 시각에 저절로 넘어감 (광고 수정 없음)
export const ENTRIES = ['/seoul/student/', '/gwangju/student/', '/seoul/work/'];

// 기수별 안내 (폼 안내 카드와 일정 문구. 금액은 등록부 fee 에서, 날짜는 여기서)
export const COHORT_INFO = {
  '3': { period: '10월 6일(화) ~ 10월 8일(목), 3일', deadlineKo: '10월 5일(월)' },
  '4': { period: '10월 11일(일) ~ 10월 13일(화), 3일', deadlineKo: '10월 10일(토)' },
  '5': { period: '10월 15일(목) ~ 10월 17일(토), 3일', deadlineKo: '10월 14일(수) 18:00' },
  '6': { period: '10월 19일(월) ~ 10월 21일(수), 3일', deadlineKo: '10월 18일(일) 18:00' },
};

export function normalizePath(p) {
  if (typeof p !== 'string') return '/';
  p = p.split('?')[0].slice(0, 80);
  if (!p.startsWith('/')) p = '/' + p;
  return p.endsWith('/') ? p : p + '/';
}
export function formOf(path) {
  const p = normalizePath(path);
  return FORMS[p] ? { path: p, ...FORMS[p] } : null;
}
export function cohortDeadline(cohort, env) {
  // 로컬 시험용: 환경값 COHORT_DEADLINE 은 현재 기수에만 먹음 (ISO 문자열 또는 ms)
  if (env && env.COHORT_DEADLINE && String(cohort) === CURRENT_COHORT) {
    const v = String(env.COHORT_DEADLINE);
    const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  const iso = COHORT_DEADLINES[cohort];
  return iso ? Date.parse(iso) : null;
}
// 폼 하나의 열림/마감 상태. 등록부에 없는 경로는 마감 취급. 마감된 기수면 현재 기수의 같은 트랙 폼 경로를 next 로 줌
export function formStatus(path, now = Date.now(), env) {
  const f = formOf(path);
  if (!f) return { open: false, unknown: true, deadline: null, serverNow: now, next: '/' };
  let deadline = f.noDeadline ? null : cohortDeadline(f.cohort, env);
  const own = formDeadline(f, env);   // 폼 하나만 먼저 닫는 마감 (자정 마감 할인). 기수 마감과 견줘 이른 쪽
  if (own != null && !f.noDeadline) deadline = deadline == null ? own : Math.min(deadline, own);
  const open = deadline == null ? true : now < deadline;
  return { open, deadline, serverNow: now, cohort: f.cohort, plan: f.plan, next: open ? null : (nextFormPath(f) || (own != null ? regularFormPath(f) : null)) };
}
// 폼 자체 마감 (등록부 deadline). 로컬 시험용 환경값 FORM_DEADLINE 은 자체 마감이 있는 폼에만 먹음 (ISO 문자열 또는 ms)
export function formDeadline(f, env) {
  if (!f || !f.deadline) return null;
  if (env && env.FORM_DEADLINE) {
    const v = String(env.FORM_DEADLINE);
    const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  const t = Date.parse(f.deadline);
  return Number.isFinite(t) ? t : null;
}
// 같은 기수 같은 트랙의 정가 폼 (자체 마감이 지난 할인 폼이 안내할 곳)
export function regularFormPath(f) {
  const cur = Object.keys(FORMS).filter((p) => FORMS[p].cohort === f.cohort && FORMS[p].track === f.track && FORMS[p].plan === 'regular');
  return cur.find((p) => FORMS[p].entry) || cur[0] || null;
}
export function nextFormPath(f) {
  if (!f || f.cohort === CURRENT_COHORT) return null;
  // 고정 링크가 가리키는 폼(entry)이 있으면 그쪽 (5기부터 개선판), 없으면 기존판
  const cur = Object.keys(FORMS).filter((p) => FORMS[p].cohort === CURRENT_COHORT && FORMS[p].track === f.track && FORMS[p].plan === 'regular');
  const same = cur.find((p) => FORMS[p].entry) || cur.find((p) => !FORMS[p].variant);
  return same || '/';
}
// 고정 링크가 보낼 폼: entry 가 같은 폼 중 지금 열린 것, 그중 마감이 가장 이른 것(다음 기수를 미리 올려 둬도 앞 기수가 끝날 때까지 앞 기수로).
//   열린 게 없으면 가장 최근 기수 폼(마감 안내가 뜸)
export function entryTarget(entry, now = Date.now(), env) {
  const e = normalizePath(entry);
  const cand = Object.keys(FORMS).filter((p) => FORMS[p].entry === e);
  if (!cand.length) return null;
  const st = cand.map((p) => ({ p, ...formStatus(p, now, env), n: Number(FORMS[p].cohort) || 0 }));
  const open = st.filter((x) => x.open).sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || a.n - b.n);
  if (open.length) return open[0].p;
  return st.sort((a, b) => b.n - a.n)[0].p;
}
export function cohortStatus(now = Date.now(), env, cohort = CURRENT_COHORT) {
  const deadline = cohortDeadline(cohort, env);
  return { open: deadline == null ? true : now < deadline, deadline, serverNow: now, cohort };
}
// 지역 선택(/)에 보여줄 현재 기수 폼. listed 가 켜진 것만 (직장인 사전알림, 할인은 링크로만)
export function listedForms(cohort = CURRENT_COHORT) {
  return Object.keys(FORMS).filter((p) => (FORMS[p].cohort === cohort || FORMS[p].noDeadline) && FORMS[p].listed).map((p) => ({ path: p, ...FORMS[p] }));
}
export function cohorts() {
  const seen = [];
  for (const p of Object.keys(FORMS)) if (!seen.includes(FORMS[p].cohort)) seen.push(FORMS[p].cohort);
  return seen;
}
export function feeLabel(f) {
  if (!f) return '';
  if (f.plan === 'prealert') return '사전알림 (무료)';
  if (f.plan === 'jnu_festival') return '전남대 축제 4,900원';
  const won = f.fee.toLocaleString('ko-KR') + '원';
  if (f.invite) return '친구 초대 ' + won;
  if (f.rejoin) return '재참여 ' + won;
  return f.plan === 'early' ? '사전알림 ' + won : f.plan === 'discount' ? '할인 ' + won : '일반 ' + won;
}
