// B 팔 정적 파일로 직접 오면 (링크 공유 등) 같은 주소 /7/seoul/ 로 돌려보냄. 쿼리 그대로 + ab=b 로 고정 (제출 경로가 /7/seoul/ 여야 서버가 폼을 찾음)
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = new URLSearchParams(url.search); q.set('ab', 'b');
  return new Response(null, { status: 302, headers: { location: '/7/seoul/?' + q.toString(), 'cache-control': 'no-store' } });
}
