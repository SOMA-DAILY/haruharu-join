// 마감된 기수의 정가 폼으로 오면 지금 기수 폼으로 바로 302 (10/10). 4기 광고 링크(/4/seoul/?src=…)도 끊기지 않고 5기로 이어짐.
// 쿼리(src, fbclid) 그대로. 할인, 재참여, 사전알림, 축제 폼은 그대로 마감 안내. 갈 곳은 shared/forms.mjs 의 nextFormPath
import { formOf, formStatus, FORMS } from '../shared/forms.mjs';

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'GET') return context.next();
  const url = new URL(request.url);
  const f = formOf(url.pathname);
  if (!f || f.plan !== 'regular' || f.festival) return context.next();
  const st = formStatus(f.path, Date.now(), context.env);
  if (st.open || !st.next || st.next === '/' || st.next === f.path) return context.next();
  const q = new URLSearchParams(url.search);
  const m = /^(?:h\d+[a-z]*|ad)-[a-z0-9]+-(m|f)(?:-|$)/i.exec(q.get('src') || '');
  if (m && !q.get('g') && FORMS[st.next] && FORMS[st.next].variant) q.set('g', m[1].toLowerCase());
  const qs = q.toString();
  return new Response(null, { status: 302, headers: { location: st.next + (qs ? '?' + qs : ''), 'cache-control': 'no-store' } });
}
