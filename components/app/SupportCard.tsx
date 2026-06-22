// components/app/SupportCard.tsx
// Calm, optional support card for the bottom of the dashboard. No gating, no
// popups — just an appreciative ask. Links open Ko-fi in a new tab.
import { SUPPORT_LINKS } from '../../lib/support'

export default function SupportCard() {
  return (
    <div className="calm-card soft sc">
      <div className="sc-title">☕ Support the project</div>
      <p className="sc-body">
        If this site helps you stay informed without anxiety, consider supporting its development.
      </p>
      <p className="sc-body">
        Your support helps keep the site free and independent for everyone.
      </p>
      <div className="sc-actions">
        <a className="btn btn-primary" href={SUPPORT_LINKS.oneTime} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>
        <a className="btn btn-ghost" href={SUPPORT_LINKS.monthly} target="_blank" rel="noopener noreferrer">Monthly support</a>
      </div>

      <style>{`
        .sc { margin-bottom: 30px; }
        .sc-title { font-size: 17px; font-weight: 600; color: var(--c-text); margin-bottom: 8px; }
        .sc-body { font-size: 14px; color: var(--c-text-soft); line-height: 1.55; max-width: 60ch; margin-bottom: 8px; }
        .sc-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
      `}</style>
    </div>
  )
}
