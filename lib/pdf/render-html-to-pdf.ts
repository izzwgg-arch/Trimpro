import puppeteer, { type Browser } from 'puppeteer'

let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      // Required on many Linux hosts (incl. Docker/VPS) unless Chromium sandbox is configured.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
  }
  return browserPromise
}

export async function renderPdfFromHtml(
  html: string,
  options?: { waitUntil?: 'load' | 'networkidle0' | 'domcontentloaded' }
): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()

  const waitUntil =
    options?.waitUntil === 'load' || options?.waitUntil === 'domcontentloaded'
      ? options.waitUntil
      : (['load', 'networkidle0'] as const)

  try {
    await page.setContent(html, { waitUntil })

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in',
      },
    })

    return Buffer.from(pdf)
  } finally {
    await page.close().catch(() => {})
  }
}

