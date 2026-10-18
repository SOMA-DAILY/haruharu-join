// 마감된 기수의 정가 폼으로 오면 지금 기수 폼으로 바로 302 (10/10). 4기 광고 링크(/4/seoul/?src=…)도 끊기지 않고 5기로 이어짐.
// 쿼리(src, fbclid) 그대로. 할인, 재참여, 사전알림, 축제 폼은 그대로 마감 안내. 갈 곳은 shared/forms.mjs 의 nextFormPath
import { formOf, formStatus, entryTarget, FORMS } from '../shared/forms.mjs';

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'GET') return context.next();
  const url = new URL(request.url);
  const f = formOf(url.pathname);
  if (!f || f.plan !== 'regular' || f.festival) return context.next();
  const st = formStatus(f.path, Date.now(), context.env);
  // 열린 폼인데 링크 성별(g)이 다른 기수로 가야 하면 그쪽 (등록부 genderTo, 10/18 남자는 6기 대신 7기)
  if (st.open && f.genderTo) {
    const gq = new URLSearchParams(url.search), gv = (gq.get('g') || '').toLowerCase();
    const to = f.genderTo[gv === 'm' ? '남성' : gv === 'f' ? '여성' : ''];
    if (to && to !== f.path && formStatus(to, Date.now(), context.env).open)
      return new Response(null, { status: 302, headers: { location: to + '?' + gq.toString(), 'cache-control': 'no-store' } });
  }
  if (st.open || !st.next || st.next === '/' || st.next === f.path) return context.next();
  const q = new URLSearchParams(url.search);
  const m = /^(?:h\d+[a-z]*|ad)-[a-z0-9]+-(m|f)(?:-|$)/i.exec(q.get('src') || '');
  const g = (q.get('g') || (m ? m[1] : '')).toLowerCase();
  // 그 성별이 먼저 가는 열린 폼(entryFirst, 10/18 남자는 7기 먼저)이 있으면 그쪽, 아니면 지금 기수
  const first = g && FORMS[st.next] && FORMS[st.next].entry && entryTarget(FORMS[st.next].entry, Date.now(), context.env, g);
  const next = first && FORMS[first].entryFirst === g && formStatus(first, Date.now(), context.env).open ? first : st.next;
  if (next === f.path) return context.next();
  if (m && !q.get('g') && FORMS[next] && FORMS[next].variant) q.set('g', m[1].toLowerCase());
  const qs = q.toString();
  return new Response(null, { status: 302, headers: { location: next + (qs ? '?' + qs : ''), 'cache-control': 'no-store' } });
}
