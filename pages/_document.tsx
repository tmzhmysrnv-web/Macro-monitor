// pages/_document.tsx
// Sets <html lang="en"> (DevTools a11y: "<html> element must have a lang
// attribute") and holds the document-level structure. Page <head> tags still
// live in each page's next/head + _app.tsx.
import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
