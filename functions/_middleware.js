// TARA QMS 로그인 관문 (Cloudflare Pages Functions - 커스텀 로그인 + 접속기록)
// ─ 모든 요청을 가로채, 로그인 안 됐으면 예쁜 로그인 화면을 보여준다.
// ─ 계정은 코드에 안 넣고 Cloudflare Pages 환경변수 LOGIN_USERS 에 저장.
//   형식: "아이디1:비번1,아이디2:비번2,..."
// ─ 로그인 성공 시: 세션 쿠키(tara_auth) + 사용자 쿠키(tara_user) 발급 + 접속기록을 구글시트에 저장.
// ─ 접속기록/관리자 판별용 관리자 아이디는 ADMIN_USER.

const APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycby4dE8hBu5dhYa8aNUNfPKrgPjtAttT6WLDXJe-hQ8aeTXXNlzAssUKL0exCR0dvjVO/exec';
const SHEET_KEY = 'tara2026';
const ADMIN_USER = 'wkbae';   // 접속기록을 볼 수 있는 관리자 아이디

export async function onRequest(context) {
  const { request, env, next } = context;

  const raw = (env.LOGIN_USERS || '').trim();
  const allowed = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  if (allowed.size === 0) return next(); // 미설정 시 잠그지 않음(먹통 방지)

  const url = new URL(request.url);

  // 1) 로그인 제출 처리
  if (request.method === 'POST' && url.pathname === '/__login') {
    let user = '', pass = '';
    try {
      const form = await request.formData();
      user = String(form.get('id') || '').trim();
      pass = String(form.get('pw') || '');
    } catch (e) {}
    if (allowed.has(user + ':' + pass)) {
      const token = btoa(unescape(encodeURIComponent(user + ':' + pass)));
      // 접속기록 저장 (완료 보장, 응답은 기다리지 않음)
      const ip = request.headers.get('CF-Connecting-IP') || '';
      const ua = request.headers.get('User-Agent') || '';
      context.waitUntil(logAccess(user, ip, ua));
      const h = new Headers();
      h.set('Location', '/quality_dashboard.html');
      // 세션 쿠키(브라우저 닫으면 재로그인). tara_user 는 화면에서 읽어 관리자 판별용(HttpOnly 아님)
      h.append('Set-Cookie', `tara_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
      h.append('Set-Cookie', `tara_user=${encodeURIComponent(user)}; Path=/; Secure; SameSite=Lax`);
      return new Response(null, { status: 302, headers: h });
    }
    return loginPage('아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  // 2) 로그아웃
  if (url.pathname === '/__logout') {
    const h = new Headers();
    h.set('Location', '/');
    h.append('Set-Cookie', 'tara_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    h.append('Set-Cookie', 'tara_user=; Path=/; Secure; SameSite=Lax; Max-Age=0');
    return new Response(null, { status: 302, headers: h });
  }

  // 3) 쿠키 인증 확인
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)tara_auth=([^;]+)/);
  if (m) {
    let val = '';
    try { val = decodeURIComponent(escape(atob(m[1]))); } catch (e) { val = ''; }
    if (allowed.has(val)) return next(); // 인증됨 → 사이트 표시
  }

  // 4) 미인증 → 로그인 페이지
  return loginPage('');
}

// 접속기록 한 줄을 구글시트에 저장 (변경이력과 같은 append 방식). row[1]='ACCESS'
async function logAccess(user, ip, ua) {
  try {
    await fetch(APPS_SCRIPT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        key: SHEET_KEY,
        row: ['', 'ACCESS', new Date().toISOString(), user, ip, String(ua).slice(0, 120)],
      }),
    });
  } catch (e) {}
}

function loginPage(errMsg) {
  const err = errMsg ? `<div class="err">${errMsg}</div>` : '';
  const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>타라TPS 품질관리시스템 · 로그인</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;
    background:linear-gradient(135deg,#1e293b 0%,#334f8c 55%,#4f46e5 100%);}
  .card{width:340px;background:#fff;border-radius:18px;padding:36px 30px 30px;
    box-shadow:0 20px 60px rgba(0,0,0,.35);}
  .logo{text-align:center;font-size:22px;font-weight:800;color:#1e293b;letter-spacing:-.3px}
  .logo span{color:#17A2B8}
  .sub{text-align:center;color:#8a93a8;font-size:12.5px;margin:6px 0 22px}
  label{display:block;font-size:12px;color:#556;font-weight:600;margin:14px 0 5px}
  input{width:100%;padding:12px 13px;border:1px solid #d7dbe3;border-radius:10px;font-size:14px;outline:none;transition:.15s}
  input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.15)}
  button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:10px;cursor:pointer;
    font-size:15px;font-weight:700;color:#fff;background:linear-gradient(135deg,#334f8c,#4f46e5);transition:.15s}
  button:hover{filter:brightness(1.08)}
  .err{background:#fdecef;color:#c0392b;font-size:12.5px;padding:9px 12px;border-radius:8px;margin-bottom:6px;text-align:center}
  .foot{text-align:center;color:#aab;font-size:11px;margin-top:18px}
</style></head>
<body>
  <form class="card" method="POST" action="/__login" autocomplete="off">
    <div class="logo">타라TPS <span>품질관리</span></div>
    <div class="sub">품질개선팀 통합품질관리시스템</div>
    ${err}
    <label>아이디</label>
    <input name="id" type="text" autofocus required>
    <label>비밀번호</label>
    <input name="pw" type="password" required>
    <button type="submit">로그인</button>
    <div class="foot">TARA TPS · Quality Management System</div>
  </form>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}
