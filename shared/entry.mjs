// 고정 링크 처리 (10/10). /seoul/student/ 같은 주소로 오면 지금 열린 기수 폼으로 302, 쿼리(src, fbclid, utm) 그대로.
// 실제 신청과 방문 기록은 /5/... 같은 기수 경로에서 일어나서 관리 페이지 기수 구분은 그대로임. 갈 곳은 shared/forms.mjs 의 entry
import { entryTarget, FORMS } from './forms.mjs';

// 광고 코드의 성별 (h4t-stu-m-film, h5-seoul-f-ieum → m/f). 개선판 화면이 ?g= 로 남녀 화면을 고름
function genderOf(q) {
  const g = (q.get('g') || '').toLowerCase();
  if (g === 'm' || g === 'f') return g;
  const m = /^(?:h\d+[a-z]*|ad)-[a-z0-9]+-(m|f)(?:-|$)/i.exec(q.get('src') || q.get('utm_content') || '');
  return m ? m[1].toLowerCase() : '';
}

export function entryHandler(entry) {
  return async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const q = new URLSearchParams(url.search);
    const g = genderOf(q);
    const to = entryTarget(entry, Date.now(), context.env, g);
    if (!to) return new Response('not found', { status: 404 });
    if (g && !q.get('g') && FORMS[to] && FORMS[to].variant) q.set('g', g);
    const qs = q.toString();
    return new Response(null, { status: 302, headers: { location: to + (qs ? '?' + qs : ''), 'cache-control': 'no-store' } });
  };
}
