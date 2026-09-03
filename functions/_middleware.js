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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;800&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.1.0/dist/tabler-icons.min.css">
<style>
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;
    color:#1d1d1f;background:#f5f5f7;}
  .card{position:relative;width:372px;padding:38px 34px 26px;border-radius:18px;
    background:#fff;border:1px solid #e8e8ed;box-shadow:0 10px 40px rgba(0,0,0,.08);
    animation:rise .5s cubic-bezier(.2,.8,.2,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  .logo-wrap{width:180px;margin:0 auto 10px;padding:0;display:flex;align-items:center;justify-content:center;background:transparent}
  .logo-img{display:block;width:100%;height:auto}
  .logo{text-align:center;font-weight:700;font-size:20px;color:#1d1d1f;letter-spacing:-.2px}
  .sub{text-align:center;color:#86868b;font-size:13px;margin:5px 0 22px}
  label{display:block;font-size:12px;color:#86868b;font-weight:500;margin:14px 0 6px}
  .field{position:relative}
  .field i{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:#a1a1a8;font-size:18px}
  input{width:100%;padding:12px 14px 12px 40px;border-radius:10px;font-size:14px;color:#1d1d1f;outline:none;
    background:#f5f5f7;border:1px solid #d2d2d7;transition:.16s}
  input::placeholder{color:#a1a1a8}
  input:focus{border-color:#17A2B8;background:#fff;box-shadow:0 0 0 4px rgba(23,162,184,.15)}
  button{width:100%;margin-top:24px;padding:13px;border:0;border-radius:10px;cursor:pointer;
    font-size:15px;font-weight:700;color:#fff;font-family:inherit;background:#17A2B8;transition:.18s}
  button:hover{background:#138496}
  button:active{transform:translateY(1px)}
  .err{background:#fdeaec;color:#d70015;border:1px solid #f5c2c7;
    font-size:12.5px;padding:10px 12px;border-radius:9px;margin-bottom:4px;text-align:center}
  .foot{text-align:center;color:#b0b0b8;font-size:10.5px;margin-top:18px;letter-spacing:.4px}
</style></head>
<body>
  <form class="card" method="POST" action="/__login" autocomplete="off">
    <div class="logo-wrap"><img class="logo-img" src="data:image/png;base64,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" alt="tara"></div>
    <div class="logo">통합품질관리시스템</div>
    <div class="sub">생산본부 품질개선팀</div>
    ${err}
    <label>아이디</label>
    <div class="field"><i class="ti ti-user"></i><input name="id" type="text" placeholder="아이디" autofocus required></div>
    <label>비밀번호</label>
    <div class="field"><i class="ti ti-lock"></i><input name="pw" type="password" placeholder="비밀번호" required></div>
    <button type="submit">로그인</button>
    <div class="foot">TARA TPS · QUALITY MANAGEMENT SYSTEM</div>
  </form>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}
