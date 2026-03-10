export interface EstimateApprovalEmailOptions {
  /** Recipient's display name, e.g. "Izzy Weinstock" */
  recipientName: string
  /** Customer / company name on the estimate, e.g. "gefen" */
  customerName: string
  /** Estimate number, e.g. "EST-0088913" */
  estimateNumber: string
  /** Total amount formatted as a currency string, e.g. "$0.20" */
  total: string
  /** Human-readable date + time string, e.g. "March 10, 2026 • 3:24 PM" */
  sentDisplay: string
  /** Full URL for the one-click approve action */
  approveUrl: string
  /** Full URL to download the estimate PDF */
  pdfUrl: string
  /** Optional custom message body from the sender */
  message?: string
  /** Optional expiry date string, e.g. "March 17, 2026" */
  validUntil?: string
  /** Absolute URL to the company logo */
  logoUrl?: string
  /** Company / brand display name, default "TrimPro" */
  companyName?: string
  /** Support / reply-to email shown in footer */
  supportEmail?: string
  /** Brand primary / card background color, default #243f53 */
  primaryColor?: string
  /** Brand accent color (gold), default #f8dea4 */
  accentColor?: string
}

function esc(v: string | null | undefined): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildEstimateApprovalEmail(opts: EstimateApprovalEmailOptions): string {
  const {
    recipientName,
    customerName,
    estimateNumber,
    total,
    sentDisplay,
    approveUrl,
    pdfUrl,
    message,
    validUntil,
    logoUrl,
    companyName = 'TrimPro',
    supportEmail = 'support@trimpro.app',
    primaryColor = '#243f53',
    accentColor = '#f8dea4',
  } = opts

  const safeMessage = message
    ? `<tr>
        <td style="padding:0 0 20px 0;font-size:14px;line-height:1.7;color:#c7d2fe;white-space:pre-wrap;">
          ${esc(message)}
        </td>
      </tr>`
    : ''

  const expiryRow = validUntil
    ? `<tr><td style="padding:0 20px;">
        <div style="height:1px;background-color:#334155;"></div>
       </td></tr>
       <tr>
         <td style="padding:12px 20px;">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
             <tr>
               <td style="font-size:12px;color:#f59e0b;font-weight:600;">⚠ Valid until</td>
               <td style="font-size:12px;color:#f59e0b;font-weight:700;text-align:right;">${esc(validUntil)}</td>
             </tr>
           </table>
         </td>
       </tr>`
    : ''

  const logoBlock = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" width="140"
         style="display:block;height:auto;max-height:48px;width:auto;max-width:140px;margin:0 auto 6px;" />`
    : `<div style="font-size:24px;font-weight:800;letter-spacing:-0.5px;color:${esc(accentColor)};margin:0 0 6px;">
         ${esc(companyName)}
       </div>`

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
  <title>Estimate ${esc(estimateNumber)} from ${esc(companyName)}</title>
  <style>
    @media (prefers-color-scheme:dark){
      .email-body{background-color:#0f172a!important;}
      .email-card{background-color:${esc(primaryColor)}!important;}
      .inner-card{background-color:#1e3345!important;border-color:#334155!important;}
      .footer-block{background-color:#1e2a3c!important;}
    }
    @media only screen and (max-width:600px){
      .email-card{border-radius:0!important;}
      .card-pad{padding:24px 18px!important;}
      .header-pad{padding:28px 18px 22px!important;}
      .footer-pad{padding:22px 18px!important;}
      .amount-cell{font-size:34px!important;}
      .headline{font-size:24px!important;}
      .btn-primary{padding:14px 20px!important;font-size:15px!important;}
      .btn-secondary{padding:12px 18px!important;font-size:14px!important;}
      .btn-col{display:block!important;width:100%!important;margin:0 0 10px!important;}
    }
  </style>
</head>
<body class="email-body" style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <div style="display:none;font-size:1px;color:#0f172a;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Estimate ${esc(estimateNumber)} • ${esc(total)} is ready for your review — tap to approve.&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:#0f172a;padding:36px 12px;">
    <tr>
      <td align="center" valign="top">

        <table role="presentation" class="email-card" cellpadding="0" cellspacing="0" border="0"
          style="max-width:580px;width:100%;background-color:${esc(primaryColor)};border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.55),0 4px 16px rgba(0,0,0,0.3);">

          <!-- HEADER -->
          <tr>
            <td class="header-pad"
              style="background:linear-gradient(160deg,${esc(primaryColor)} 0%,#1e3345 100%);padding:36px 36px 28px;text-align:center;border-bottom:1px solid #334155;">
              ${logoBlock}
              <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${esc(accentColor)};opacity:0.8;">
                Estimate Request
              </div>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td class="card-pad" style="padding:32px 36px 24px;text-align:center;border-bottom:1px solid #334155;">
              <div style="display:inline-block;background-color:#1e3345;border:1px solid #334155;border-radius:100px;padding:5px 14px;margin-bottom:18px;">
                <span style="font-size:12px;font-weight:600;color:#c7d2fe;letter-spacing:0.4px;">
                  &#9203;&nbsp; Awaiting Your Approval
                </span>
              </div>
              <h1 class="headline"
                style="margin:0 0 10px;font-size:28px;font-weight:800;line-height:1.2;letter-spacing:-0.4px;color:${esc(accentColor)};">
                Review Your Estimate
              </h1>
              <p style="margin:0;font-size:14px;font-weight:500;color:#94a3b8;">
                Estimate&nbsp;<span style="color:#c7d2fe;font-weight:600;">${esc(estimateNumber)}</span>&nbsp;&bull;&nbsp;${esc(sentDisplay)}
              </p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td class="card-pad" style="padding:28px 36px;">

              <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#f1f5f9;">
                Hi ${esc(recipientName)},
              </p>
              <p style="margin:0 0 26px;font-size:15px;line-height:1.65;color:#c7d2fe;">
                Please review the estimate prepared for <strong style="color:#e2e8f0;">${esc(customerName)}</strong> (${esc(estimateNumber)}).
                Once you approve, we&rsquo;ll get started right away.
              </p>

              ${safeMessage}

              <!-- DETAILS CARD -->
              <table role="presentation" class="inner-card" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#1e3345;border:1px solid #334155;border-radius:12px;overflow:hidden;margin-bottom:24px;">

                <tr>
                  <td style="padding:12px 20px;border-bottom:1px solid #334155;background-color:rgba(255,255,255,0.025);">
                    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;">
                      Estimate Details
                    </p>
                  </td>
                </tr>

                <!-- Estimate ID -->
                <tr>
                  <td style="padding:13px 20px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;padding-bottom:13px;">Estimate ID</td>
                        <td style="font-size:13px;color:#e2e8f0;font-weight:600;text-align:right;padding-bottom:13px;">${esc(estimateNumber)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 20px;"><div style="height:1px;background:#334155;"></div></td></tr>

                <!-- Customer -->
                <tr>
                  <td style="padding:13px 20px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;padding-bottom:13px;">Customer</td>
                        <td style="font-size:13px;color:#e2e8f0;font-weight:600;text-align:right;padding-bottom:13px;">${esc(customerName)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 20px;"><div style="height:1px;background:#334155;"></div></td></tr>

                <!-- Prepared for -->
                <tr>
                  <td style="padding:13px 20px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;padding-bottom:13px;">Prepared for</td>
                        <td style="font-size:13px;color:#e2e8f0;font-weight:600;text-align:right;padding-bottom:13px;">${esc(recipientName)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 20px;"><div style="height:1px;background:#334155;"></div></td></tr>

                <!-- Date -->
                <tr>
                  <td style="padding:13px 20px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;padding-bottom:13px;">Date</td>
                        <td style="font-size:13px;color:#e2e8f0;font-weight:600;text-align:right;padding-bottom:13px;">${esc(sentDisplay)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                ${expiryRow}

                <tr><td style="padding:0 20px;"><div style="height:1px;background:#334155;"></div></td></tr>

                <!-- Total Amount (featured row) -->
                <tr>
                  <td style="padding:18px 20px 20px;background:linear-gradient(135deg,rgba(248,222,164,0.07) 0%,rgba(248,222,164,0.02) 100%);">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;vertical-align:middle;">Total Amount</td>
                        <td class="amount-cell"
                          style="font-size:38px;font-weight:800;color:${esc(accentColor)};text-align:right;line-height:1;letter-spacing:-1px;vertical-align:middle;">
                          ${esc(total)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
              <!-- END DETAILS CARD -->

              <!-- BUTTONS -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                      class="btn-col" style="display:inline-table;margin:0 8px 10px 0;">
                      <tr>
                        <td>
                          <a href="${esc(approveUrl)}" class="btn-primary" target="_blank" rel="noopener noreferrer"
                            style="display:inline-block;padding:15px 34px;font-size:15px;font-weight:700;letter-spacing:0.2px;text-decoration:none;border-radius:10px;background:linear-gradient(135deg,${esc(accentColor)} 0%,#f0c974 100%);color:#1e2937;box-shadow:0 4px 18px rgba(248,222,164,0.32),0 2px 6px rgba(0,0,0,0.25);line-height:1.2;">
                            &#10003;&nbsp;&nbsp;Approve Estimate
                          </a>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                      class="btn-col" style="display:inline-table;margin:0 0 10px 0;">
                      <tr>
                        <td>
                          <a href="${esc(pdfUrl)}" class="btn-secondary" target="_blank" rel="noopener noreferrer"
                            style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;letter-spacing:0.2px;text-decoration:none;border-radius:10px;background-color:#334155;color:#e2e8f0;border:1px solid #4a5f75;line-height:1.2;">
                            &#8595;&nbsp;&nbsp;Download PDF
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- END BUTTONS -->

              <!-- Help note -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#1e3345;border:1px solid #334155;border-radius:10px;">
                <tr>
                  <td style="padding:14px 18px;text-align:center;">
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
                      &#128172;&nbsp; Questions or need changes?&nbsp;
                      <strong style="color:#c7d2fe;">Just reply to this email</strong>
                      &nbsp;&mdash; we&rsquo;re happy to assist.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="footer-block footer-pad"
              style="background-color:#1e2a3c;padding:22px 36px;border-top:1px solid #334155;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${esc(accentColor)};letter-spacing:0.3px;">
                ${esc(companyName)}
              </p>
              <p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#4a5f75;">
                ${esc(supportEmail)}
              </p>
              <div style="height:1px;background-color:#334155;max-width:220px;margin:10px auto;"></div>
              <p style="margin:0;font-size:11px;line-height:1.7;color:#4a5f75;">
                Reference: <span style="color:#64748b;">${esc(estimateNumber)}</span><br />
                This is an automated message &mdash; please do not reply directly to this address.
              </p>
            </td>
          </tr>

        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="height:28px;">&nbsp;</td></tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`
}
