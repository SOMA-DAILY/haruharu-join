// 4기 서울 학생 랜딩 A/B (10/8). /4/seoul/ 로 들어온 사람을 반반 나눔
//  a = 기존 폼 그대로 (정적 파일), b = 개선판 /4/seoul/v2/ 로 302 (쿼리 그대로 + 성별 g)
// 광고 링크는 안 바꿈. 한 번 정해진 쪽은 쿠키로 유지. 주소가 /v2/ 로 바뀌니 접수, 방문 기록, Mixpanel, 픽셀이 폼별로 저절로 나뉨
// 나누는 건 메타 광고 링크만 (src 가 h4t- h3r- h4s- h4-seoul-m|f|ctr-). 메시지, 바이오, 재참가, src 없는 방문은 기존 폼 그대로
// 크롤러(메타 미리보기 등)는 항상 a. 시험용: ?ab=a / ?ab=b 로 고정. 끄려면 이 파일을 지움
const COOKIE = 'hh_ab_4seoul';
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|facebot|meta-externalagent|preview|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http/i;

// 광고 코드의 성별: h4t-stu-m-film, h3r-seoul-f-reel, h4-seoul-m-... → m/f. 없으면 ''
function genderOf(q) {
  const g = (q.get('g') || '').toLowerCase();
  if (g === 'm' || g === 'f') return g;
  const m = /^h\d+[a-z]*-[a-z0-9]+-(m|f)(?:-|$)/i.exec(q.get('src') || q.get('utm_content') || '');
  return m ? m[1].toLowerCase() : '';
}

// 메타 광고 링크 코드 (tracking/links.json 의 4기 서울 학생 메타 광고)
const META_AD = /^(?:h4t|h3r|h4s)-|^h4-seoul-(?:m|f|ctr)-/i;

function readCookie(req) {
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=(a|b)').exec(req.headers.get('cookie') || '');
  return m ? m[1] : '';
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (BOT.test(request.headers.get('user-agent') || '')) return context.next();
  const forced = url.searchParams.get('ab');
  if (forced !== 'a' && forced !== 'b' && !META_AD.test(url.searchParams.get('src') || '')) return context.next();
  let arm = forced === 'a' || forced === 'b' ? forced : readCookie(request);
  const fresh = !arm;
  if (!arm) arm = crypto.getRandomValues(new Uint8Array(1))[0] < 128 ? 'a' : 'b';
  const cookie = `${COOKIE}=${arm}; Path=/4/; Max-Age=2592000; SameSite=Lax` + (url.protocol === 'https:' ? '; Secure' : '');
  if (arm === 'b') {
    const q = new URLSearchParams(url.search);
    q.delete('ab');
    const g = genderOf(q);
    if (g && !q.get('g')) q.set('g', g);
    const qs = q.toString();
    return new Response(null, { status: 302, headers: { location: '/4/seoul/v2/' + (qs ? '?' + qs : ''), 'set-cookie': cookie, 'cache-control': 'no-store' } });
  }
  const res = await context.next();
  if (!fresh && !forced) return res;
  const out = new Response(res.body, res);
  out.headers.append('set-cookie', cookie);
  out.headers.set('cache-control', 'no-store');
  return out;
}
