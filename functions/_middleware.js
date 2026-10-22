// 마감된 기수의 정가 폼으로 오면 지금 기수 폼으로 바로 302 (10/10). 4기 광고 링크(/4/seoul/?src=…)도 끊기지 않고 5기로 이어짐.
// 쿼리(src, fbclid) 그대로. 할인, 재참여, 사전알림, 축제 폼은 그대로 마감 안내. 갈 곳은 shared/forms.mjs 의 nextFormPath
import { formOf, formStatus, entryTarget, FORMS } from '../shared/forms.mjs';
import { genderCookie, genderCookieHeader } from '../shared/entry.mjs';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  // 잘못 발송한 공용 후기 문자 주소만 복구. 이전 기수의 동일 문자 링크도 함께 이동(운영자 승인).
  // 목적지는 고정이며 원래 성별/추적 파라미터는 유지. 영구 캐시 없이 되돌릴 수 있게 302.
  if (['GET', 'HEAD'].includes(request.method) && url.pathname.replace(/\/$/, '') === '/rejoin/seoul' && url.searchParams.get('src') === 'rejoin-msg') {
    const q = new URLSearchParams(url.search);
    q.set('src', 'rejoin-6-msg');
    return new Response(null, { status: 302, headers: {
      location: '/rejoin/6/seoul/?' + q.toString(), 'cache-control': 'no-store',
    } });
  }
  if (request.method !== 'GET') return context.next();
  const f = formOf(url.pathname);
  if (!f || f.plan !== 'regular' || f.festival) return context.next();
  const q = new URLSearchParams(url.search);
  const m = /^(?:h\d+[a-z]*|ad)-[a-z0-9]+-(m|f)(?:-|$)/i.exec(q.get('src') || '');
  const linkG = (q.get('g') || (m ? m[1] : '')).toLowerCase();
  const g = linkG || genderCookie(request);   // 10/22: 광고로 지나간 폰의 성별 쿠키 (shared/entry.mjs)
  const st = formStatus(f.path, Date.now(), context.env, g);
  if (st.open || !st.next || st.next === '/' || st.next === f.path) return context.next();
  // 그 성별이 먼저 가는 열린 폼(entryFirst, 10/18 남자는 7기 먼저)이 있으면 그쪽, 아니면 지금 기수
  const first = g && FORMS[st.next] && FORMS[st.next].entry && entryTarget(FORMS[st.next].entry, Date.now(), context.env, g);
  const next = first && FORMS[first].entryFirst === g && formStatus(first, Date.now(), context.env).open ? first : st.next;
  if (next === f.path) return context.next();
  if (g && !q.get('g') && FORMS[next] && FORMS[next].variant) q.set('g', g);   // 광고 src 또는 쿠키 성별을 남녀 화면 g 로
  const qs = q.toString();
  const headers = new Headers({ location: next + (qs ? '?' + qs : ''), 'cache-control': 'no-store' });
  if (linkG === 'm' || linkG === 'f') headers.append('set-cookie', genderCookieHeader(linkG, url));
  return new Response(null, { status: 302, headers });
}
