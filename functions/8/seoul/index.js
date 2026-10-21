// 8기 서울 학생 랜딩 50/50 (10/21, 7기 functions/7/seoul/ 과 같은 틀. 판정은 8기까지 팔당 LPV 2,000). /8/seoul/ 로 들어온 메타 광고 유입을 반반 나눔
//  a = 지금 폼 그대로 (정적 public/8/seoul/index.html), b = 후보판 public/8/seoul/_b/index.html 을 **같은 주소에서** 냄 (302 없음, 광고 URL/src 그대로)
// 한 번 정해진 쪽은 쿠키(hh_ab_8seoul, /8/)로 유지 → 재방문도 같은 팔. 팔 라벨은 페이지가 쿠키를 읽어 세션/제출(hidden.arm)과 Mixpanel 에 남김
// 나누는 건 메타 광고 링크만 (src 가 ad-{지역}-{m|f}-...). 바이오, 메시지, src 없는 방문은 a. 단 광고로 이미 배정된 쿠키가 있으면 그대로
// 크롤러는 항상 a. 시험용: ?ab=a / ?ab=b 로 고정. 끄려면 이 파일과 _b/ 를 지움 (4기 때 functions/4/seoul/index.js 와 같은 틀)
const COOKIE = 'hh_ab_8seoul';
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|facebot|meta-externalagent|preview|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http/i;
const META_AD = /^ad-[a-z0-9]+-(?:m|f)-/i;

function readCookie(req) {
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=(a|b)').exec(req.headers.get('cookie') || '');
  return m ? m[1] : '';
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (BOT.test(request.headers.get('user-agent') || '')) return context.next();
  const forced = url.searchParams.get('ab');
  const saved = readCookie(request);
  if (forced !== 'a' && forced !== 'b' && !saved && !META_AD.test(url.searchParams.get('src') || '')) return context.next();
  let arm = forced === 'a' || forced === 'b' ? forced : saved;
  const fresh = !arm;
  if (!arm) arm = crypto.getRandomValues(new Uint8Array(1))[0] < 128 ? 'a' : 'b';
  let res;
  if (arm === 'b' && env.ASSETS) {
    const bUrl = new URL(url); bUrl.pathname = '/8/seoul/_b/'; bUrl.search = '';
    res = await env.ASSETS.fetch(new Request(bUrl.toString(), { headers: request.headers }));
    if (!res.ok) { res = await context.next(); arm = 'a'; }   // _b 를 못 가져오면 a 화면 + a 로 기록 (화면과 라벨이 어긋나지 않게)
  } else {
    res = await context.next();
  }
  const cookie = `${COOKIE}=${arm}; Path=/8/; Max-Age=2592000; SameSite=Lax` + (url.protocol === 'https:' ? '; Secure' : '');
  const out = new Response(res.body, res);
  if (fresh || forced) out.headers.append('set-cookie', cookie);
  out.headers.set('cache-control', 'no-store');
  return out;
}
