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
  body{margin:0;display:flex;align-items:center;justify-content:center;overflow:hidden;
    font-family:'Noto Sans KR',-apple-system,'Malgun Gothic',sans-serif;color:#eaf0ff;
    background:#0b1024;}
  /* 움직이는 오로라 배경 */
  .aurora{position:fixed;inset:-30%;z-index:0;filter:blur(70px);opacity:.9;
    background:
      radial-gradient(38% 45% at 22% 30%, #4f46e5 0%, transparent 60%),
      radial-gradient(40% 42% at 78% 25%, #17A2B8 0%, transparent 60%),
      radial-gradient(45% 50% at 60% 80%, #7c3aed 0%, transparent 62%),
      radial-gradient(40% 45% at 25% 75%, #0ea5e9 0%, transparent 60%);
    animation:drift 16s ease-in-out infinite alternate;}
  @keyframes drift{0%{transform:translate(0,0) scale(1) rotate(0deg)}
    50%{transform:translate(3%,-2%) scale(1.08) rotate(8deg)}
    100%{transform:translate(-3%,3%) scale(1.04) rotate(-6deg)}}
  .grid{position:fixed;inset:0;z-index:0;opacity:.06;
    background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);
    background-size:46px 46px;mask-image:radial-gradient(circle at center,#000 40%,transparent 78%)}
  /* 글래스 카드 */
  .card{position:relative;z-index:2;width:360px;padding:40px 34px 30px;border-radius:22px;
    background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);
    backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);
    box-shadow:0 30px 80px rgba(4,8,30,.55),inset 0 1px 0 rgba(255,255,255,.25);
    animation:rise .6s cubic-bezier(.2,.8,.2,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
  .badge{width:56px;height:56px;margin:0 auto 16px;border-radius:16px;display:flex;align-items:center;justify-content:center;
    font-family:'Poppins';font-weight:800;font-size:22px;color:#fff;letter-spacing:.5px;
    background:linear-gradient(135deg,#17A2B8,#4f46e5);box-shadow:0 10px 30px rgba(79,70,229,.55),0 0 0 1px rgba(255,255,255,.2) inset}
  .logo{text-align:center;font-family:'Poppins';font-weight:800;font-size:22px;color:#fff;letter-spacing:-.2px;
    text-shadow:0 2px 20px rgba(120,140,255,.5)}
  .sub{text-align:center;color:#aab6e6;font-size:12.5px;margin:6px 0 24px}
  label{display:block;font-size:12px;color:#c6cdf0;font-weight:500;margin:16px 0 6px}
  .field{position:relative}
  .field i{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#9aa6d8;font-size:18px}
  input{width:100%;padding:13px 14px 13px 42px;border-radius:12px;font-size:14px;color:#fff;outline:none;
    background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);transition:.18s}
  input::placeholder{color:#8b96c4}
  input:focus{border-color:#8ea2ff;background:rgba(255,255,255,.12);box-shadow:0 0 0 4px rgba(110,130,255,.22)}
  button{width:100%;margin-top:26px;padding:14px;border:0;border-radius:12px;cursor:pointer;
    font-size:15px;font-weight:700;color:#fff;letter-spacing:.3px;font-family:'Noto Sans KR';
    background:linear-gradient(135deg,#17A2B8 0%,#4f46e5 60%,#7c3aed 100%);background-size:180% 180%;
    box-shadow:0 12px 34px rgba(79,70,229,.5);transition:.2s;animation:sheen 6s linear infinite}
  @keyframes sheen{0%{background-position:0% 50%}100%{background-position:180% 50%}}
  button:hover{transform:translateY(-2px);box-shadow:0 18px 44px rgba(79,70,229,.62)}
  button:active{transform:translateY(0)}
  .err{background:rgba(224,49,79,.16);color:#ffd0d8;border:1px solid rgba(255,120,140,.4);
    font-size:12.5px;padding:10px 12px;border-radius:10px;margin-bottom:4px;text-align:center}
  .foot{text-align:center;color:#7f8bc0;font-size:10.5px;margin-top:20px;letter-spacing:.4px}
</style></head>
<body>
  <div class="aurora"></div>
  <div class="grid"></div>
  <form class="card" method="POST" action="/__login" autocomplete="off">
    <div class="badge">TARA</div>
    <div class="logo">타라TPS 품질관리</div>
    <div class="sub">품질개선팀 통합품질관리시스템</div>
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
