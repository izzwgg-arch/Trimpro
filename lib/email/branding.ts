import { prisma } from '@/lib/prisma'
import { resolveEmailTheme } from '@/lib/branding/theme'
import { sanitizeOptionalHtmlBlock } from '@/lib/branding/sanitize'
import { getBrandingSettingsForTenant } from '@/lib/branding/settings'

export async function getEmailBranding(tenantId: string) {
  const model = (prisma as any)?.brandingSettings
  const branding = model && typeof model.findUnique === 'function'
    ? await model.findUnique({ where: { tenantId } })
    : await getBrandingSettingsForTenant(tenantId)
  if (!branding) return null
  return branding
}

export function applyEmailBrandingHtml(
  html: string,
  branding: Record<string, any> | null | undefined
): string {
  if (!branding) return html
  const theme = resolveEmailTheme(branding)
  let next = html

  // Inline-safe replacements for existing template palette.
  next = next.replaceAll('#12344d', theme.button)
  next = next.replaceAll('#111827', theme.cardBackground)
  next = next.replaceAll('rgba(255,255,255,0.92)', theme.textPrimary)
  next = next.replaceAll('rgba(255,255,255,0.68)', theme.textSecondary)
  next = next.replaceAll('#ffffff', theme.background)
  next = next.replaceAll('rgba(255,255,255,0.12)', theme.border)

  if (branding.emailLogoUrl) {
    const logoImg = `<img src="${branding.emailLogoUrl}" alt="Brand logo" style="max-width:300px;height:auto;display:block;margin-bottom:12px;" />`
    next = next.replace(
      /<td style="padding:28px 28px 24px 28px;">/i,
      `<td style="padding:28px 28px 24px 28px;">${logoImg}`
    )
  }

  const customHeader = sanitizeOptionalHtmlBlock(branding.emailCustomHeaderHTML)
  const customFooter = sanitizeOptionalHtmlBlock(branding.emailCustomFooterHTML)
  if (customHeader) {
    next = next.replace(/<body[^>]*>/i, (match) => `${match}${customHeader}`)
  }
  if (customFooter) {
    next = next.replace(/<\/body>/i, `${customFooter}</body>`)
  }

  if (branding.emailFooterText || branding.emailSignature) {
    const footerText = [branding.emailFooterText, branding.emailSignature].filter(Boolean).join('<br />')
    next = next.replace(
      /<\/table>\s*<\/td>\s*<\/tr>\s*<\/table>\s*<\/body>/i,
      `<div style="padding:16px; font-size:12px; color:${theme.textSecondary};">${footerText}</div></table></td></tr></table></body>`
    )
  }

  return next
}

