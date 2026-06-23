// lib/resultPage.ts
// Minimal standalone HTML page for the confirm / unsubscribe landing screens.
// Honors the same light/dark palette as the app via prefers-color-scheme.

const CANONICAL_URL = 'https://istheworldbreaking.com'
const SITE = () => {
  const s = (process.env.SITE_URL || '').replace(/\/$/, '')
  return s && !/\.vercel\.app$/i.test(s) ? s : CANONICAL_URL
}

export function resultPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} · is the world breaking?</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      font-family:system-ui,-apple-system,sans-serif; background:#F7F6F3; color:#1A1A18; padding:1.5rem; }
    .card { max-width:420px; text-align:center; }
    h1 { font-size:22px; font-weight:500; margin:0 0 10px; }
    p { font-size:14px; line-height:1.6; color:#6B6B67; margin:0 0 24px; }
    a { display:inline-block; font-size:14px; font-weight:500; color:#1A1A18; text-decoration:none;
      border:1px solid rgba(0,0,0,0.15); border-radius:8px; padding:9px 18px; }
    @media (prefers-color-scheme: dark) {
      body { background:#111110; color:#EEEEE8; }
      p { color:#8A8A84; }
      a { color:#EEEEE8; border-color:rgba(255,255,255,0.18); }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${body}</p>
    <a href="${SITE()}">← Back to the dashboard</a>
  </div>
</body>
</html>`
}

// A confirmation screen whose action is a POST (so email link-scanners that
// merely GET-prefetch the link can't trigger it). Used by the unsubscribe flow.
export function confirmPage(title: string, body: string, actionUrl: string, button = 'Confirm'): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} · is the world breaking?</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      font-family:system-ui,-apple-system,sans-serif; background:#F7F6F3; color:#1A1A18; padding:1.5rem; }
    .card { max-width:420px; text-align:center; }
    h1 { font-size:22px; font-weight:500; margin:0 0 10px; }
    p { font-size:14px; line-height:1.6; color:#6B6B67; margin:0 0 24px; }
    button { font:inherit; font-size:14px; font-weight:500; color:#fff; background:#1A1A18; cursor:pointer;
      border:none; border-radius:8px; padding:10px 20px; }
    .back { display:block; margin-top:16px; font-size:13px; color:#8A8A84; text-decoration:none; }
    @media (prefers-color-scheme: dark) {
      body { background:#111110; color:#EEEEE8; }
      p { color:#8A8A84; }
      button { background:#EEEEE8; color:#111110; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${body}</p>
    <form method="post" action="${actionUrl}"><button type="submit">${button}</button></form>
    <a class="back" href="${SITE()}">Keep my subscription</a>
  </div>
</body>
</html>`
}
