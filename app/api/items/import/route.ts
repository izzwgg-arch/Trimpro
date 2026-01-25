import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const { csvData } = body

    if (!csvData || typeof csvData !== 'string') {
      return NextResponse.json({ error: 'CSV data is required' }, { status: 400 })
    }

    // Parse CSV
    const lines = csvData.split('\n').filter((line: string) => line.trim())
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have at least a header and one data row' }, { status: 400 })
    }

    const headers = lines[0].split(',').map((h: string) => h.trim().replace(/^"|"$/g, ''))
    const dataRows = lines.slice(1)

    const errors: Array<{ row: number; error: string }> = []
    const imported: string[] = []
    const skipped: string[] = []

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      if (!row.trim()) continue

      const values = row.split(',').map((v: string) => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
      
      try {
        const nameIndex = headers.indexOf('Name')
        if (nameIndex === -1 || !values[nameIndex]) {
          errors.push({ row: i + 2, error: 'Name is required' })
          continue
        }

        const name = values[nameIndex]
        const sku = values[headers.indexOf('SKU')] || null
        const type = values[headers.indexOf('Type')] || 'PRODUCT'
        const description = values[headers.indexOf('Description')] || null
        const unit = values[headers.indexOf('Unit')] || 'ea'
        const defaultUnitCost = values[headers.indexOf('Unit Cost')] ? parseFloat(values[headers.indexOf('Unit Cost')]) : null
        const defaultUnitPrice = values[headers.indexOf('Unit Price')] ? parseFloat(values[headers.indexOf('Unit Price')]) : 0
        const taxable = values[headers.indexOf('Taxable')]?.toLowerCase() === 'yes'
        const taxRate = values[headers.indexOf('Tax Rate')] ? parseFloat(values[headers.indexOf('Tax Rate')]) : null
        const isActive = values[headers.indexOf('Active')]?.toLowerCase() !== 'no'
        const vendorName = values[headers.indexOf('Vendor')] || null
        const categoryName = values[headers.indexOf('Category')] || null
        const tagsStr = values[headers.indexOf('Tags')] || ''
        const tags = tagsStr ? tagsStr.split(';').map((t: string) => t.trim()).filter(Boolean) : []
        const notes = values[headers.indexOf('Notes')] || null

        // Validate type
        const validTypes = ['PRODUCT', 'SERVICE', 'MATERIAL', 'FEE']
        if (!validTypes.includes(type.toUpperCase())) {
          errors.push({ row: i + 2, error: `Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}` })
          continue
        }

        // Check for duplicate SKU
        if (sku) {
          const existing = await prisma.item.findFirst({
            where: {
              tenantId: user.tenantId,
              sku,
            },
          })
          if (existing) {
            skipped.push(name)
            continue
          }
        }

        // Resolve vendor
        let vendorId: string | null = null
        if (vendorName) {
          const vendor = await prisma.vendor.findFirst({
            where: {
              tenantId: user.tenantId,
              name: { equals: vendorName, mode: 'insensitive' },
            },
          })
          vendorId = vendor?.id || null
        }

        // Resolve category
        let categoryId: string | null = null
        if (categoryName) {
          let category = await prisma.itemCategory.findFirst({
            where: {
              tenantId: user.tenantId,
              name: { equals: categoryName, mode: 'insensitive' },
            },
          })
          if (!category) {
            // Create category if it doesn't exist
            category = await prisma.itemCategory.create({
              data: {
                tenantId: user.tenantId,
                name: categoryName,
              },
            })
          }
          categoryId = category.id
        }

        await prisma.item.create({
          data: {
            tenantId: user.tenantId,
            name,
            sku,
            type: type.toUpperCase() as any,
            description,
            unit,
            defaultUnitCost,
            defaultUnitPrice,
            taxable,
            taxRate,
            isActive,
            vendorId,
            categoryId,
            tags,
            notes,
          },
        })

        imported.push(name)
      } catch (error: any) {
        errors.push({ row: i + 2, error: error.message || 'Unknown error' })
      }
    }

    return NextResponse.json({
      success: true,
      imported: imported.length,
      skipped: skipped.length,
      errors: errors.length,
      details: {
        imported,
        skipped,
        errors,
      },
    })
  } catch (error) {
    console.error('Import items error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
