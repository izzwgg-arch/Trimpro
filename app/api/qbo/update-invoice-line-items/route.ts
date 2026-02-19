import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getQboSessionForTenant } from '@/lib/qbo/session'
import { quickBooksService } from '@/lib/services/quickbooks'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    // Get all invoices that were imported from QuickBooks (have qboSyncId)
    const invoices = await prisma.invoice.findMany({
      where: {
        tenantId: user.tenantId,
        qboSyncId: { not: null },
      },
      include: {
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (invoices.length === 0) {
      return NextResponse.json({ 
        message: 'No QuickBooks-imported invoices found to update',
        updated: 0 
      })
    }

    // Get QuickBooks session
    const session = await getQboSessionForTenant(user.tenantId)
    if (!session) {
      return NextResponse.json(
        { error: 'QuickBooks integration not configured' },
        { status: 400 }
      )
    }

    let updatedCount = 0
    let errorCount = 0
    const errors: string[] = []

    // Process each invoice
    for (const invoice of invoices) {
      try {
        if (!invoice.qboSyncId) continue

        // Fetch the invoice from QuickBooks
        const qboInvoice = await quickBooksService.makeAPIRequest(
          session.accessToken,
          session.realmId,
          `/invoice/${invoice.qboSyncId}`,
          'GET'
        )

        const inv = qboInvoice?.Invoice || qboInvoice
        if (!inv || !inv.Line) {
          console.warn(`[Update Line Items] No line items found for invoice ${invoice.id} (QBO: ${invoice.qboSyncId})`)
          continue
        }

        // Process line items from QuickBooks
        const qboLines = Array.isArray(inv.Line) ? inv.Line : []
        const lineItemsMap = new Map<number, { itemName: string; description: string }>()

        qboLines
          .filter((l: any) => l && typeof l === 'object')
          .filter((l: any) => {
            const dt = String(l.DetailType || '')
            return dt !== 'SubTotalLineDetail' && dt !== 'DescriptionOnly'
          })
          .forEach((l: any, idx: number) => {
            // Extract item name from ItemRef
            const itemName = String(l?.SalesItemLineDetail?.ItemRef?.name || '') || 
                            String(l?.SalesItemLineDetail?.ItemRef?.value || '') || 
                            ''
            
            // Extract description from Description field
            const description = String(l.Description || '')
            
            lineItemsMap.set(idx, {
              itemName: itemName || description || `QuickBooks line ${idx + 1}`,
              description: description && itemName ? description : '',
            })
          })

        // Update existing line items in the database
        // Match by sortOrder (index)
        const localLineItems = invoice.lineItems
        let lineItemUpdated = false

        for (let i = 0; i < localLineItems.length; i++) {
          const localItem = localLineItems[i]
          const qboData = lineItemsMap.get(i)
          
          if (qboData) {
            // Update the line item with item name and description
            await prisma.invoiceLineItem.update({
              where: { id: localItem.id },
              data: {
                description: qboData.itemName,
                notes: qboData.description || null,
              },
            })
            lineItemUpdated = true
          }
        }

        if (lineItemUpdated) {
          updatedCount++
        }
      } catch (error: any) {
        errorCount++
        const errorMsg = `Invoice ${invoice.invoiceNumber || invoice.id}: ${error?.message || String(error)}`
        errors.push(errorMsg)
        console.error(`[Update Line Items] Error updating invoice ${invoice.id}:`, error)
      }
    }

    return NextResponse.json({
      message: `Updated ${updatedCount} invoice(s)`,
      updated: updatedCount,
      errors: errorCount,
      errorDetails: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error('[Update Line Items] Fatal error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to update invoice line items' },
      { status: 500 }
    )
  }
}
