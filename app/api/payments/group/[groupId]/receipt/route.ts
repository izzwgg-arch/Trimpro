import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireWebOrMobilePermission } from '@/lib/authorization'
import {
  generatePaymentGroupReceiptPdf,
  getPaymentGroupReceiptHtml,
  loadPaymentGroupReceiptContext,
} from '@/lib/payments/group-receipts'

export const runtime = 'nodejs'

async function assertAccess(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return { error: authError }
  const permError = await requireWebOrMobilePermission(
    request,
    'payments.view',
    'mobile.jobs.view_documents'
  )
  if (permError) return { error: permError }
  return { user: getAuthUser(request) }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const access = await assertAccess(request)
  if ('error' in access && access.error) return access.error
  const { user } = access

  const format = request.nextUrl.searchParams.get('format') || 'pdf'
  const shouldDownload = request.nextUrl.searchParams.get('download') === '1'

  try {
    if (format === 'json') {
      const ctx = await loadPaymentGroupReceiptContext(params.groupId, user.tenantId)
      if (!ctx) return NextResponse.json({ error: 'Payment group not found' }, { status: 404 })
      return NextResponse.json({ group: ctx })
    }

    if (format === 'html') {
      const result = await getPaymentGroupReceiptHtml(params.groupId, user.tenantId)
      if (!result) return NextResponse.json({ error: 'Payment group not found' }, { status: 404 })
      return new NextResponse(result.html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }

    const result = await generatePaymentGroupReceiptPdf(params.groupId, user.tenantId)
    if (!result) return NextResponse.json({ error: 'Payment group not found' }, { status: 404 })
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Group receipt error:', error)
    return NextResponse.json({ error: 'Failed to generate group receipt' }, { status: 500 })
  }
}
