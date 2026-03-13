export interface PaymentReceiptEmailOptions {
  /** Recipient's display name, e.g. "Izzy Weinstock" */
  recipientName: string
  /** Amount formatted as currency string, e.g. "$0.20" */
  amountPaid: string
  /** JavaScript Date or ISO string of when the payment was processed */
  paidAt: Date | string
  /** Payment / transaction identifier shown in monospace */
  transactionId: string
  /** One-liner description shown in the receipt row */
  description?: string
  /** Absolute URL to the company logo (≥200px wide, PNG/SVG preferred) */
  logoUrl?: string
  /** Company display name shown in footer, default "TrimPro" */
  companyName?: string
  /** Reply-to / support email shown in footer */
  supportEmail?: string
  /** Full company address line for footer compliance */
  companyAddress?: string
  /** Link to the online receipt page */
  receiptUrl?: string
  /** Link to the invoice */
  invoiceUrl?: string
}

function esc(v: string | null | undefined): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d)
}

export function buildPaymentReceiptEmail(opts: PaymentReceiptEmailOptions): string {
  const {
    recipientName,
    amountPaid,
    paidAt,
    transactionId,
    description = 'Outstanding invoices payment',
    logoUrl,
    companyName = 'TrimPro',
    supportEmail = 'support@trimprony.com',
    companyAddress = '',
    receiptUrl,
    invoiceUrl,
  } = opts

  const dateString = formatDate(paidAt)

  const logoBlock = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" width="140" height="40"
         style="display:block;height:40px;width:auto;max-width:180px;object-fit:contain;" />`
    : `<span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">${esc(companyName)}</span>`

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <title>Payment Receipt — ${esc(companyName)}</title>
  <style>
    /* ── Reset ── */
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0;mso-table-rspace:0}
    img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
    body{margin:0;padding:0;width:100%!important;min-width:100%}

    /* ── Dark mode ── */
    @media (prefers-color-scheme:dark){
      .body-bg{background-color:#0f1117!important}
      .card-bg{background-color:#1a1d27!important;border-color:#2d3146!important}
      .receipt-box{background-color:#12151f!important;border-color:#2d3146!important}
      .receipt-divider{border-color:#2d3146!important}
      .h1-text{color:#f1f5f9!important}
      .body-text{color:#94a3b8!important}
      .label-text{color:#64748b!important}
      .value-text{color:#e2e8f0!important}
      .amount-text{color:#a5b4fc!important}
      .txn-text{color:#7dd3fc!important}
      .footer-bg{background-color:#0f1117!important}
      .footer-text{color:#475569!important}
      .prefooter-text{color:#334155!important}
    }

    /* ── Responsive ── */
    @media only screen and (max-width:620px){
      .email-container{width:100%!important;max-width:100%!important}
      .card-padding{padding:28px 20px!important}
      .receipt-padding{padding:18px 16px!important}
    }
  </style>
</head>
<body class="body-bg" style="margin:0;padding:0;background-color:#f0f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <!-- Email wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f0f2f8;">
    <tr>
      <td align="center" style="padding:32px 16px 40px;">

        <!-- ═══════════════════════════════════ CARD ═══════════════════════════════════ -->
        <table role="presentation" class="email-container card-bg" cellpadding="0" cellspacing="0" border="0"
          width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;
          border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,0.07),0 1px 4px rgba(0,0,0,0.05);">

          <!-- ─── HEADER GRADIENT ─── -->
          <tr>
            <td style="border-radius:16px 16px 0 0;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 60%,#9333ea 100%);padding:32px 40px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <!-- Logo -->
                    ${logoBlock}
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:16px;">
                    <!-- Badge -->
                    <span style="display:inline-block;background:rgba(255,255,255,0.18);
                      border:1px solid rgba(255,255,255,0.28);border-radius:999px;
                      padding:5px 14px;font-size:12px;font-weight:600;letter-spacing:0.06em;
                      color:#ffffff;text-transform:uppercase;">
                      Payment Receipt
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ─── MAIN BODY ─── -->
          <tr>
            <td class="card-padding" style="padding:36px 40px 32px;">

              <!-- Greeting -->
              <p style="margin:0 0 6px;font-size:15px;color:#6b7280;">Hi ${esc(recipientName)},</p>

              <!-- Headline -->
              <h1 class="h1-text" style="margin:0 0 14px;font-size:28px;font-weight:800;
                letter-spacing:-0.6px;color:#111827;line-height:1.25;">
                Payment Received ✓
              </h1>

              <!-- Body text -->
              <p class="body-text" style="margin:0 0 28px;font-size:15px;line-height:1.65;color:#4b5563;">
                Thank you for your payment. We've received and applied it to your
                outstanding invoice(s). Your account is up to date.
              </p>

              <!-- ─── RECEIPT BOX ─── -->
              <table role="presentation" class="receipt-box" cellpadding="0" cellspacing="0" border="0" width="100%"
                style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">

                <!-- Amount row — hero -->
                <tr>
                  <td class="receipt-padding" style="padding:22px 24px 18px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td>
                          <p class="label-text" style="margin:0 0 4px;font-size:11px;font-weight:600;
                            letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Amount Paid</p>
                          <p class="amount-text" style="margin:0;font-size:36px;font-weight:800;
                            letter-spacing:-1px;color:#4f46e5;line-height:1.1;">
                            ${esc(amountPaid)}
                          </p>
                        </td>
                        <!-- Green success pill -->
                        <td align="right" valign="top" style="padding-top:4px;">
                          <span style="display:inline-block;background:#dcfce7;border:1px solid #bbf7d0;
                            border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;color:#15803d;">
                            ✓ Paid
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Divider -->
                <tr><td class="receipt-divider" style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</td></tr>

                <!-- Detail rows -->
                <tr>
                  <td class="receipt-padding" style="padding:18px 24px 20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

                      <!-- Date -->
                      <tr>
                        <td style="padding:7px 0;" valign="top">
                          <p class="label-text" style="margin:0;font-size:12px;font-weight:500;color:#9ca3af;">Date</p>
                        </td>
                        <td align="right" style="padding:7px 0;" valign="top">
                          <p class="value-text" style="margin:0;font-size:13px;font-weight:500;color:#374151;">
                            ${esc(dateString)}
                          </p>
                        </td>
                      </tr>

                      <!-- Thin rule -->
                      <tr><td colspan="2" style="border-top:1px solid #f3f4f6;font-size:0;line-height:0;padding:0;">&nbsp;</td></tr>

                      <!-- Transaction ID -->
                      <tr>
                        <td style="padding:7px 0;" valign="top">
                          <p class="label-text" style="margin:0;font-size:12px;font-weight:500;color:#9ca3af;">Transaction ID</p>
                        </td>
                        <td align="right" style="padding:7px 0;" valign="top">
                          <p class="txn-text" style="margin:0;font-size:12px;font-weight:600;
                            font-family:'SF Mono','Fira Mono','Cascadia Mono','Roboto Mono',
                            'Courier New',Courier,monospace;color:#0369a1;letter-spacing:0.04em;">
                            ${esc(transactionId)}
                          </p>
                        </td>
                      </tr>

                      <!-- Thin rule -->
                      <tr><td colspan="2" style="border-top:1px solid #f3f4f6;font-size:0;line-height:0;padding:0;">&nbsp;</td></tr>

                      <!-- Description -->
                      <tr>
                        <td style="padding:7px 0;" valign="top">
                          <p class="label-text" style="margin:0;font-size:12px;font-weight:500;color:#9ca3af;">Description</p>
                        </td>
                        <td align="right" style="padding:7px 0;" valign="top">
                          <p class="value-text" style="margin:0;font-size:13px;font-weight:500;color:#374151;">
                            ${esc(description)}
                          </p>
                        </td>
                      </tr>

                    </table>
                  </td>
                </tr>

              </table>
              <!-- /RECEIPT BOX -->

              <!-- CTA Buttons -->
              ${(receiptUrl || invoiceUrl) ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;margin-bottom:8px;">
                <tr>
                  <td align="center">
                    ${receiptUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 6px 0 0;border-radius:12px;"><tr><td bgcolor="#f0c974" style="border-radius:12px;"><a href="${esc(receiptUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:16px 48px;font-size:17px;font-weight:700;letter-spacing:0.2px;line-height:1.2;text-decoration:none;text-align:center;border-radius:12px;background:linear-gradient(135deg,#2a5f82 0%,#f0c974 100%);color:#1e2937;">View Receipt</a></td></tr></table>` : ''}
                    ${invoiceUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;border-radius:12px;"><tr><td bgcolor="#f0c974" style="border-radius:12px;"><a href="${esc(invoiceUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:16px 48px;font-size:17px;font-weight:700;letter-spacing:0.2px;line-height:1.2;text-decoration:none;text-align:center;border-radius:12px;background:linear-gradient(135deg,#2a5f82 0%,#f0c974 100%);color:#1e2937;">View Invoice</a></td></tr></table>` : ''}
                  </td>
                </tr>
              </table>` : ''}

              <!-- Closing copy -->
              <p class="body-text" style="margin:28px 0 0;font-size:14px;line-height:1.65;color:#6b7280;text-align:center;">
                If you have any questions, just reply to this email —
                we're here to help.
              </p>

            </td>
          </tr>

          <!-- ─── FOOTER ─── -->
          <tr>
            <td class="footer-bg" style="background-color:#f8fafc;border-top:1px solid #e5e7eb;
              border-radius:0 0 16px 16px;padding:24px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <p class="footer-text" style="margin:0 0 4px;font-size:13px;
                      font-weight:600;color:#374151;">
                      ${esc(companyName)}
                    </p>
                    ${companyAddress
                      ? `<p class="footer-text" style="margin:0 0 4px;font-size:11px;color:#9ca3af;">${esc(companyAddress)}</p>`
                      : ''}
                    <p class="footer-text" style="margin:0;font-size:12px;color:#9ca3af;">
                      Thank you for your business.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /CARD -->

        <!-- Pre-footer note -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
          style="max-width:600px;width:100%;margin-top:16px;">
          <tr>
            <td align="center">
              <p class="prefooter-text" style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">
                This is an automated receipt — please do not reply unless you have questions.<br />
                <a href="mailto:${esc(supportEmail)}" style="color:#a5b4fc;text-decoration:none;">${esc(supportEmail)}</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`
}

/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMIZATION GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BRAND COLORS
  Header gradient  → gradient(135deg, #4f46e5 → #7c3aed → #9333ea)
                     Swap with your brand: e.g. #0ea5e9 → #6366f1 for
                     a sky-indigo look, or #10b981 → #059669 for green.
  Amount color     → #4f46e5 (indigo-600). Match your primary brand hue.
  "Paid" badge     → #dcfce7 / #15803d (emerald). Always keep green for
                     positive confirmation — it's universal.
  Transaction ID   → #0369a1 (sky-700). Monospace, stands out clearly.
  Dark-mode amount → #a5b4fc (indigo-300). Bright enough on dark slate.

LOGO
  Pass a full absolute URL via the `logoUrl` option:
    buildPaymentReceiptEmail({ ..., logoUrl: 'https://app.trimprony.com/branding/trimpro-logo.svg' })
  Recommended size: 140–180px wide × 36–44px tall, transparent PNG or SVG.
  If logoUrl is omitted the company name renders as bold white text.

EMAIL CLIENT GOTCHAS
  • Outlook (Windows)  : `border-radius` on <td> is ignored — the card
    corners will be square. Wrap content in a VML rounded rect if needed.
    The `<!--[if mso]>` block above sets 96 DPI so font sizes render correctly.
  • Gmail (web/app)    : strips <style> blocks that aren't in <head>.
    All critical styles are inline; the <style> block covers only
    dark-mode & responsive which Gmail ignores gracefully.
  • Apple Mail / iOS   : full dark-mode support via the media query classes.
  • Yahoo Mail         : ignores @media entirely — light mode only, which
    is fine since all inline styles are already light-mode safe.
  • `linear-gradient`  : not supported in Outlook; the header will render
    as a plain fallback background. Add `bgcolor` fallback if needed:
    <td bgcolor="#4f46e5" style="background:linear-gradient(...)">
  • `box-shadow`       : ignored in all email clients — cosmetic only for
    webmail. The border provides structural separation everywhere else.
  • Min font size      : iOS Mail enforces ≥13px on body text. All text
    here is ≥11px (fine for labels); critical copy is ≥13px.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/
