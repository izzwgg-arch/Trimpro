export interface EstimateApprovalEmailOptions {
  recipientName: string
  customerName: string
  estimateNumber: string
  total: string
  sentDisplay: string
  approveUrl: string
  pdfUrl: string
  message?: string
  validUntil?: string
  logoUrl?: string
  companyName?: string
  supportEmail?: string
  primaryColor?: string
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

  const logoBlock = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" width="130"
         style="display:inline-block;height:auto;max-height:44px;width:auto;max-width:130px;border:0;margin-bottom:4px;"
         onerror="this.style.display='none'" />`
    : ''

  const messageRow = message
    ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#c7d2fe;white-space:pre-wrap;">${esc(message)}</p>`
    : ''

  const expiryBanner = validUntil
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background-color:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);
               border-radius:8px;margin-bottom:20px;">
        <tr>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#f59e0b;text-align:center;">
            &#9888;&ensp;This estimate expires on ${esc(validUntil)}
          </td>
        </tr>
      </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
  <title>Estimate ${esc(estimateNumber)} &mdash; ${esc(companyName)}</title>
  <style>
    @media (prefers-color-scheme:dark){
      .email-body { background-color:#0f172a !important; }
      .main-card  { background-color:${esc(primaryColor)} !important; }
      .inner-card { background-color:#1e3345 !important; border-color:#334155 !important; }
      .foot-cell  { background-color:#1e2a3c !important; }
    }
    @media only screen and (max-width:600px){
      .main-card  { border-radius:0 !important; }
      .hero-pad   { padding:28px 20px 22px !important; }
      .body-pad   { padding:24px 20px !important; }
      .foot-pad   { padding:22px 20px !important; }
      .headline   { font-size:24px !important; }
      .amount     { font-size:34px !important; }
      .btn-primary{ padding:15px 24px !important; font-size:15px !important; }
      .btn-sec    { padding:13px 20px !important; font-size:14px !important; }
      .btn-cell   { display:block !important; width:100% !important; padding:0 0 10px !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;padding:0;background-color:#0f172a;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  -webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#0f172a;">
    ${esc(estimateNumber)} &bull; ${esc(total)} ready for review. Tap to approve or download.&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;
  </div>

  <!-- View in browser -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:14px 16px 0;background-color:#0f172a;">
        <p style="margin:0;font-size:11px;color:#334155;">
          Having trouble viewing this email?&nbsp;
          <a href="#" style="color:#64748b;text-decoration:underline;">Open in browser</a>
        </p>
      </td>
    </tr>
  </table>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:#0f172a;padding:24px 12px 40px;">
    <tr>
      <td align="center" valign="top">

        <table role="presentation" class="main-card" cellpadding="0" cellspacing="0" border="0"
          style="max-width:580px;width:100%;background-color:${esc(primaryColor)};border-radius:16px;
                 overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.4),0 2px 8px rgba(0,0,0,0.25);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(170deg,${esc(primaryColor)} 0%,#1e3345 100%);
                       padding:34px 36px 26px;text-align:center;
                       border-bottom:1px solid rgba(255,255,255,0.07);">
              ${logoBlock}
              <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;
                          color:${esc(accentColor)};${logoUrl ? 'display:none;' : ''}margin-bottom:10px;">
                ${esc(companyName)}
              </div>
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:2.2px;
                        text-transform:uppercase;color:${esc(accentColor)};opacity:0.7;">
                Professional Estimates &amp; Invoicing
              </p>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td class="hero-pad"
              style="padding:30px 40px 22px;text-align:center;
                     border-bottom:1px solid rgba(255,255,255,0.07);">
              <div style="display:inline-block;background-color:#334155;border-radius:999px;
                          padding:5px 16px;margin-bottom:18px;">
                <span style="font-size:12px;font-weight:700;letter-spacing:0.3px;color:${esc(accentColor)};">
                  &#9203;&ensp;Awaiting Your Approval
                </span>
              </div>
              <h1 class="headline"
                style="margin:0 0 10px;font-size:28px;font-weight:800;line-height:1.2;
                       letter-spacing:-0.4px;color:${esc(accentColor)};">
                Review Your Estimate
              </h1>
              <p style="margin:0;font-size:13px;font-weight:500;color:#94a3b8;">
                Estimate&ensp;<span style="color:#c7d2fe;font-weight:600;">${esc(estimateNumber)}</span>
                &ensp;&bull;&ensp;${esc(sentDisplay)}
              </p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td class="body-pad" style="padding:26px 40px;">

              <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#f1f5f9;">
                Hi ${esc(recipientName)},
              </p>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#c7d2fe;">
                Please review the estimate prepared for
                <strong style="color:#e2e8f0;">${esc(customerName)}</strong>
                (${esc(estimateNumber)}).<br />
                Once approved, we&rsquo;ll get started right away.
              </p>

              ${messageRow}
              ${expiryBanner}

              <!-- DETAILS CARD -->
              <table role="presentation" class="inner-card" width="100%"
                cellpadding="0" cellspacing="0" border="0"
                style="background-color:#1e3345;border:1px solid #334155;
                       border-radius:12px;overflow:hidden;margin-bottom:22px;">

                <tr>
                  <td style="padding:11px 18px;border-bottom:1px solid #334155;
                             background-color:rgba(255,255,255,0.025);">
                    <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.8px;
                              text-transform:uppercase;color:#94a3b8;">Estimate Details</p>
                  </td>
                </tr>

                <!-- Estimate ID -->
                <tr>
                  <td style="padding:12px 18px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;padding-bottom:12px;width:44%;">Estimate ID</td>
                        <td style="font-size:13px;color:#e2e8f0;font-weight:600;text-align:right;padding-bottom:12px;">${esc(estimateNumber)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 18px;"><div style="height:1px;background:#334155;"></div></td></tr>

                <!-- Customer -->
                <tr>
                  <td style="padding:12px 18px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;padding-bottom:12px;width:44%;">Customer</td>
                        <td style="font-size:13px;color:#e2e8f0;font-weight:600;text-align:right;padding-bottom:12px;">${esc(customerName)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 18px;"><div style="height:1px;background:#334155;"></div></td></tr>

                <!-- Prepared for -->
                <tr>
                  <td style="padding:12px 18px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;padding-bottom:12px;width:44%;">Prepared for</td>
                        <td style="font-size:13px;color:#e2e8f0;font-weight:600;text-align:right;padding-bottom:12px;">${esc(recipientName)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 18px;"><div style="height:1px;background:#334155;"></div></td></tr>

                <!-- Date -->
                <tr>
                  <td style="padding:12px 18px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#94a3b8;font-weight:500;padding-bottom:12px;width:44%;">Date</td>
                        <td style="font-size:13px;color:#e2e8f0;font-weight:600;text-align:right;padding-bottom:12px;">${esc(sentDisplay)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 18px;"><div style="height:1px;background:#334155;"></div></td></tr>

                <!-- Total (featured) -->
                <tr>
                  <td style="padding:16px 18px 18px;
                             background:linear-gradient(135deg,rgba(248,222,164,0.07) 0%,transparent 100%);">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:11px;color:#94a3b8;font-weight:700;
                                   letter-spacing:1px;text-transform:uppercase;
                                   vertical-align:middle;">Total Amount</td>
                        <td class="amount"
                          style="font-size:38px;font-weight:800;color:${esc(accentColor)};
                                 text-align:right;line-height:1;letter-spacing:-1.5px;
                                 vertical-align:middle;">${esc(total)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
              <!-- END DETAILS CARD -->

              <!-- BUTTONS -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="margin-bottom:22px;">
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                      class="btn-cell" style="display:inline-table;margin:0 6px 0 0;">
                      <tr>
                        <td>
                          <a href="${esc(approveUrl)}" class="btn-primary"
                            target="_blank" rel="noopener noreferrer"
                            style="display:inline-block;padding:15px 36px;font-size:15px;font-weight:700;
                                   letter-spacing:0.2px;text-decoration:none;border-radius:10px;
                                   background:linear-gradient(135deg,${esc(accentColor)} 0%,#f0c974 100%);
                                   color:#1e2937;
                                   box-shadow:0 4px 18px rgba(248,222,164,0.28),0 1px 4px rgba(0,0,0,0.2);
                                   line-height:1.2;">
                            &#10003;&ensp;Approve Estimate
                          </a>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                      class="btn-cell" style="display:inline-table;">
                      <tr>
                        <td>
                          <a href="${esc(pdfUrl)}" class="btn-sec"
                            target="_blank" rel="noopener noreferrer"
                            style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:600;
                                   letter-spacing:0.2px;text-decoration:none;border-radius:10px;
                                   background-color:#334155;color:#e2e8f0;
                                   border:1px solid #4a5f75;line-height:1.2;">
                            &#8595;&ensp;Download PDF
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- END BUTTONS -->

              <!-- Closing note -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#1e3345;border:1px solid #334155;border-radius:10px;">
                <tr>
                  <td style="padding:13px 18px;text-align:center;">
                    <p style="margin:0;font-size:13px;line-height:1.65;color:#94a3b8;">
                      &#128172;&ensp;Questions or need changes?&ensp;
                      <strong style="color:#c7d2fe;">Just reply to this email</strong>
                      &ensp;&mdash;&ensp;we&rsquo;re happy to assist.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="foot-cell foot-pad"
              style="background-color:#1e2a3c;padding:22px 40px 24px;
                     border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0 0 5px;font-size:13px;font-weight:700;color:${esc(accentColor)};letter-spacing:0.2px;">
                ${esc(companyName)}
              </p>
              <p style="margin:0 0 10px;font-size:12px;line-height:1.7;color:#4a5f75;">
                <a href="mailto:${esc(supportEmail)}"
                  style="color:#64748b;text-decoration:none;">${esc(supportEmail)}</a>
              </p>
              <div style="height:1px;background:#334155;max-width:200px;margin:10px auto;"></div>
              <p style="margin:0 0 5px;font-size:11px;line-height:1.7;color:#374151;">
                Estimate <span style="color:#4a5f75;">${esc(estimateNumber)}</span>
                &ensp;&bull;&ensp;Sent to ${esc(customerName)}
              </p>
              <p style="margin:0;font-size:11px;line-height:1.6;color:#374151;">
                This is an automated message &mdash; please do not reply directly unless you have questions.
              </p>
            </td>
          </tr>

        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="height:28px;"></td></tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`
}
