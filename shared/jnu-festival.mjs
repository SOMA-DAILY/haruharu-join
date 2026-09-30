// 전남대 축제 이벤트 신청폼 (/jnu-festival/). 서버(/api/submit, /api/festival)와 build.sh 가 같이 읽음
// 마감: 2026-10-03(토) 15:00 KST. 로컬 시험은 환경값 JNU_FESTIVAL_DEADLINE(ISO 문자열 또는 ms)로 바꿈
export const FESTIVAL_PLAN = 'jnu_festival';
export const FESTIVAL_PATH = '/jnu-festival/';
export const FESTIVAL_DEADLINE = '2026-10-03T15:00:00+09:00';
export const AVOID_MAJOR_VALUES = ['같은 과 피하기', '상관없음'];
// 학생 인증 캡처(KV img:{신청ID})는 축제(10/7) 끝나면 KV 만료로 자동 삭제 (동의 문구: 확인 후 행사 종료 시 삭제)
export const CAPTURE_DELETE_AT = '2026-10-08T00:00:00+09:00';
// 마감을 늦춰 CAPTURE_DELETE_AT 이 지나거나 코앞이어도 만료 없이 영구 저장되지 않게, 그때는 받은 뒤 3일에 지움
export const CAPTURE_FALLBACK_TTL_SEC = 3 * 24 * 3600;
export function captureExpiration(now = Date.now()) {
  const exp = Math.floor(Date.parse(CAPTURE_DELETE_AT) / 1000), nowSec = Math.floor(now / 1000);
  return exp > nowSec + 120 ? exp : nowSec + CAPTURE_FALLBACK_TTL_SEC;
}

export function isFestival(path, plan) {
  return plan === FESTIVAL_PLAN || /^\/jnu-festival\/?$/.test(typeof path === 'string' ? path : '');
}
export function festivalDeadline(env) {
  const v = env && env.JNU_FESTIVAL_DEADLINE;
  if (v) {
    const t = /^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v));
    if (Number.isFinite(t)) return t;
  }
  return Date.parse(FESTIVAL_DEADLINE);
}
export function festivalStatus(now = Date.now(), env) {
  const deadline = festivalDeadline(env);
  return { open: now < deadline, deadline, serverNow: now };
}

// 학생 인증 캡처: 브라우저가 긴 변 1600px JPEG(보통 1.2MB 이하)로 줄여서 data:image/...;base64 로 보냄. 파일 앞부분 시그니처로 형식을 다시 확인
// 상한 2MB: 정상 캡처엔 넉넉하고, 인증 없는 /submit 로 큰 파일을 반복해 KV 용량과 쓰기 한도를 쓰는 폭은 줄임
export const CAPTURE_MAX_BYTES = 2 * 1024 * 1024;
export function sniffImage(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}
export function decodeCapture(v) {
  if (typeof v !== 'string' || !v) return { error: 'capture_missing' };
  // 머리글만 정규식으로 보고, 본문 글자 확인은 atob 에 맡김 (Workers 무료 플랜 CPU 10ms 아끼기)
  const comma = v.indexOf(',');
  if (comma < 0 || comma > 60 || !/^data:image\/[a-z0-9.+-]+;base64$/i.test(v.slice(0, comma))) return { error: 'capture_invalid' };
  const b64 = v.slice(comma + 1);
  if (b64.length > Math.ceil(CAPTURE_MAX_BYTES / 3) * 4) return { error: 'capture_too_large' };
  let bin;
  try { bin = atob(b64); } catch (e) { return { error: 'capture_invalid' }; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > CAPTURE_MAX_BYTES) return { error: 'capture_too_large' };
  const type = sniffImage(bytes);
  if (!type) return { error: 'capture_invalid' };
  return { bytes, type };
}
