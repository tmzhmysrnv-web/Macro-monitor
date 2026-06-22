// pages/api/og.tsx
// Dynamic Open Graph image (1200×630) for link previews. Rendered at the edge by
// next/og (built into Next — no extra dependency). Referenced by the og:image /
// twitter:image meta tags on the public landing page. Static, no user input.
import { ImageResponse } from 'next/og'

export const config = { runtime: 'edge' }

export default function handler() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#1B1C1F',
          padding: '72px',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="56" height="56" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="7" fill="#24262B" />
            <path d="M4 17h6l3-8 4 14 3-8h6" fill="none" stroke="#8AB84A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ color: '#9A9C9E', fontSize: 28, letterSpacing: 2 }}>istheworldbreaking.com</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ color: '#ECECEA', fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>Is the world breaking?</div>
          <div style={{ color: '#9A9C9E', fontSize: 34 }}>A quiet macro dashboard. Alerts only when it matters.</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
