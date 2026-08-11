// TARA QMS 로그인 관문 (Cloudflare Pages Functions - Basic Auth)
// ─ 사이트의 모든 요청(HTML·데이터 파일 포함)을 이 관문이 먼저 가로챈다.
// ─ 아이디/비밀번호는 소스에 넣지 않고, Cloudflare Pages 설정의
//   환경변수 LOGIN_USERS 에 저장한다. (형식: "아이디1:비번1,아이디2:비번2,...")
//   → 배원기님이 Cloudflare 대시보드에서 4명 계정을 직접 추가·변경·삭제.

export async function onRequest(context) {
  const { request, env, next } = context;

  // 허용 계정 목록 파싱 ("id:pw,id:pw,...")
  const raw = (env.LOGIN_USERS || '').trim();
  const allowed = new Set(
    raw.split(',').map((s) => s.trim()).filter(Boolean)
  );

  // 환경변수 미설정 시: 잠그지 않고 통과(설정 전 사이트가 먹통 되는 것 방지)
  if (allowed.size === 0) return next();

  const header = request.headers.get('Authorization') || '';
  if (header.startsWith('Basic ')) {
    let decoded = '';
    try { decoded = atob(header.slice(6)); } catch (e) { decoded = ''; }
    const i = decoded.indexOf(':');
    if (i >= 0) {
      const user = decoded.slice(0, i);
      const pass = decoded.slice(i + 1);
      if (allowed.has(user + ':' + pass)) {
        return next(); // 인증 통과 → 사이트 표시
      }
    }
  }

  // 미인증 → 브라우저 로그인 창 표시
  return new Response('TARA QMS — 로그인이 필요합니다.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="TARA QMS", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=UTF-8',
    },
  });
}
