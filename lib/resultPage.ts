// lib/resultPage.ts
// Minimal standalone HTML page for the confirm / unsubscribe landing screens.
// Honors the same light/dark palette as the app via prefers-color-scheme.

const SITE = () => (process.env.SITE_URL || 'https://macromonitor.vercel.app').replace(/\/$/, '')

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
