import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireWebOrMobilePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'
import { getPdfBranding } from '@/lib/branding/pdf'
import { buildEstimatePdfHtml } from '@/lib/documents/pdf-templates'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireWebOrMobilePermission(
    request,
    'estimates.view',
    'mobile.jobs.view_documents'
  )
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const shouldPrint = request.nextUrl.searchParams.get('print') === '1'
    const shouldDownload = request.nextUrl.searchParams.get('download') === '1'
    const format = request.nextUrl.searchParams.get('format') || 'pdf'
    const wantsHtml = format === 'html'
    const brand = await getPdfBranding(user.tenantId)

    const estimate = await prisma.estimate.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            companyName: true,
            email: true,
            phone: true,
          },
        },
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
        optionalItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    // Approved optional items get merged into the main line items section
    const itemApprovals = await prisma.estimateItemApproval.findMany({
      where: { estimateId: estimate.id, tenantId: user.tenantId, status: 'APPROVED' },
      select: { estimateLineItemId: true },
    })
    const approvedIdSet = new Set(itemApprovals.map((a) => a.estimateLineItemId))

    const html = buildEstimatePdfHtml(estimate, brand, approvedIdSet, { shouldPrint })

    if (wantsHtml) {
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.html"`,
        },
      })
    }

    try {
      const pdf = await renderPdfFromHtml(html)
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.pdf"`,
        },
      })
    } catch (e) {
      console.error('PDF render failed; falling back to HTML:', e)
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.html"`,
        },
      })
    }
  } catch (error) {
    console.error('Generate estimate PDF error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
