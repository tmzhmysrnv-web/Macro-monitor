// components/app/SupportCard.tsx
// Calm, optional support card for the bottom of the dashboard. No gating, no
// popups — just an appreciative ask. Links open Ko-fi in a new tab.
import { SUPPORT_LINKS } from '../../lib/support'

export default function SupportCard() {
  return (
    <div className="calm-card soft sc">
      <div className="sc-text">
        <span className="sc-title">☕ Support the project</span>
        <span className="sc-body">Help keep the site free and independent.</span>
      </div>
      <div className="sc-actions">
        <a className="btn btn-primary" href={SUPPORT_LINKS.oneTime} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>
        <a className="btn btn-ghost" href={SUPPORT_LINKS.monthly} target="_blank" rel="noopener noreferrer">Monthly</a>
      </div>

      <style>{`
        .app .calm-card.sc { padding: 14px 18px; }
        .app .sc { margin-top: 48px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .sc-text { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .sc-title { font-size: 14.5px; font-weight: 600; color: var(--c-text); }
        .sc-body { font-size: 13px; color: var(--c-text-soft); }
        .sc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .app .sc .btn { font-size: 12.5px; padding: 7px 13px; }
      `}</style>
    </div>
  )
}
