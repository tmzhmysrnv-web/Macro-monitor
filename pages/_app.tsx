import type { AppProps } from 'next/app'
import Head from 'next/head'
import { useEffect } from 'react'
import { DM_Sans, DM_Mono, Space_Mono } from 'next/font/google'
import ErrorBoundary from '../components/ErrorBoundary'
import { initSentryClient } from '../lib/sentryClient'

// Self-hosted via next/font (audit M5) — no render-blocking Google Fonts request,
// no layout shift. Exposed as :root CSS vars so the existing --mono/--sans/--c-*
// and 'Space Mono' references resolve to them across the public + app surfaces.
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'], display: 'swap' })
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap' })
const spaceMono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], display: 'swap' })

const fontVars = `:root{`
  + `--font-dm-sans:${dmSans.style.fontFamily};`
  + `--font-dm-mono:${dmMono.style.fontFamily};`
  + `--font-space-mono:${spaceMono.style.fontFamily};`
  + `}`

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => { initSentryClient() }, [])
  return (
    <>
      <Head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#1B1C1F" />
      </Head>
      <style>{fontVars}</style>
      <ErrorBoundary>
        <Component {...pageProps} />
      </ErrorBoundary>
    </>
  )
}
