import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'
import { buildPurchaseOrderPdfHtml } from '@/lib/documents/pdf-templates'

export const runtime = 'nodejs'

function defaultLogoDataUri() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360"><rect width="1200" height="360" fill="#12344d"/><g fill="#f5e7b8" font-family="Inter,Arial,Helvetica,sans-serif"><text x="78" y="238" font-size="182" font-weight="700" letter-spacing="1">TrimPro</text></g><g fill="#ffffff" transform="translate(900,78)"><rect x="0" y="0" width="220" height="24" rx="4"/><rect x="42" y="54" width="36" height="170" rx="3"/><rect x="102" y="54" width="36" height="170" rx="3"/><circle cx="20" cy="84" r="22"/><circle cx="200" cy="84" r="22"/></g></svg>'
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'purchase_orders.view')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const shouldPrint = request.nextUrl.searchParams.get('print') === '1'
    const shouldDownload = request.nextUrl.searchParams.get('download') === '1'
    const format = request.nextUrl.searchParams.get('format') || 'pdf'
    const wantsHtml = format === 'html'
    const logoUrl = process.env.PDF_LOGO_URL || process.env.NEXT_PUBLIC_PDF_LOGO_URL || defaultLogoDataUri()

    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        vendorRef: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            contactPerson: true,
          },
        },
        lineItems: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
            addresses: {
              where: { type: 'job_site' },
              take: 1,
            },
            client: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    })

    if (!purchaseOrder) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    const html = buildPurchaseOrderPdfHtml(
      purchaseOrder,
      {
        logoUrl,
        businessName: 'Trim Pro',
      },
      { shouldPrint }
    )

    if (wantsHtml) {
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="PO-${purchaseOrder.poNumber}.html"`,
        },
      })
    }

    try {
      const pdf = await renderPdfFromHtml(html)
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="PO-${purchaseOrder.poNumber}.pdf"`,
        },
      })
    } catch (e) {
      console.error('PDF render failed; falling back to HTML:', e)
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="PO-${purchaseOrder.poNumber}.html"`,
        },
      })
    }
  } catch (error) {
    console.error('Generate PDF error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
