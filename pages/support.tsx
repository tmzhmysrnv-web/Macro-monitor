// pages/support.tsx — public support page (no auth gate). Explains why the
// project exists and offers optional Ko-fi support. Never blocks any feature.
import Head from 'next/head'
import Link from 'next/link'
import AppTheme from '../components/app/AppTheme'
import { SUPPORT_LINKS } from '../lib/support'

export default function Support() {
  return (
    <>
      <Head><title>Support · Is the World Breaking?</title></Head>
      <AppTheme />
      <div className="app sp">
        <div className="sp-bar">
          <Link href="/" className="sp-brand">is the world breaking?...</Link>
          <Link href="/dashboard" className="sp-back">Dashboard →</Link>
        </div>

        <div className="sp-col">
          <section className="sp-sec">
            <h1 className="sp-h1">Why this exists</h1>
            <p className="sp-p">The internet often profits from keeping us anxious.</p>
            <p className="sp-p">istheworldbreaking.com was built to do the opposite. Our goal is simple: monitor the noise so you don't have to.</p>
            <p className="sp-p">Enjoy your life. Spend time with family and friends. We'll let you know when something truly matters.</p>
          </section>

          <section className="sp-sec">
            <h2 className="sp-h2">Keep the site independent</h2>
            <p className="sp-p">Hosting, infrastructure, development time, and future enhancements all require ongoing resources.</p>
            <p className="sp-p">If this project has brought you peace of mind, please consider supporting it.</p>
          </section>

          <section className="sp-sec">
            <h2 className="sp-h2">Support options</h2>
            <div className="sp-cards">
              <div className="calm-card sp-card">
                <div className="sp-card-title">☕ Buy me a coffee</div>
                <p className="sp-card-desc">Make a one-time contribution.</p>
                <a className="btn btn-primary btn-block" href={SUPPORT_LINKS.oneTime} target="_blank" rel="noopener noreferrer">Support once</a>
              </div>
              <div className="calm-card sp-card">
                <div className="sp-card-title">❤️ Monthly support</div>
                <p className="sp-card-desc">Help sustain long-term development.</p>
                <a className="btn btn-ghost btn-block" href={SUPPORT_LINKS.monthly} target="_blank" rel="noopener noreferrer">Become a supporter</a>
              </div>
            </div>
          </section>

          <section className="sp-close">
            <p className="sp-p">Thank you for visiting.</p>
            <p className="sp-p">Whether you choose to support financially or simply use the site, we're grateful you're here.</p>
          </section>
        </div>
      </div>

      <style>{`
        .sp { padding: 0 20px 64px; }
        .sp-bar { max-width: 640px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between;
          padding: 22px 0; }
        .sp-brand { font-family: 'Space Mono', var(--c-mono); font-size: 14px; letter-spacing: 0.04em; color: var(--c-green-deep); text-decoration: none; }
        .sp-back { font-size: 13px; color: var(--c-text-soft); text-decoration: none; }
        .sp-back:hover { color: var(--c-text); }
        .sp-col { max-width: 640px; margin: 0 auto; }
        .sp-sec { margin: 28px 0; }
        .sp-h1 { font-size: 28px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 12px; }
        .sp-h2 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
        .sp-p { font-size: 15px; line-height: 1.65; color: var(--c-text-soft); margin-bottom: 12px; }
        .sp-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
        .sp-card { display: flex; flex-direction: column; }
        .sp-card-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
        .sp-card-desc { font-size: 13.5px; color: var(--c-text-soft); line-height: 1.5; margin-bottom: 16px; flex: 1; }
        .sp-close { max-width: 520px; margin: 40px auto 0; text-align: center; }
        .sp-close .sp-p { color: var(--c-text-soft); }
        @media (max-width: 560px) { .sp-cards { grid-template-columns: 1fr; } }
      `}</style>
    </>
  )
}
