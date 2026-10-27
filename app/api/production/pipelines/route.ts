import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { hasPermission, requirePermission } from '@/lib/authorization'
import {
  getPipelineConfigForTenant,
  loadEstimatePipeline,
  loadInvoicePipeline,
  loadJobsForAllWork,
  type PipelineItem,
} from '@/lib/production/pipeline-data'

/**
 * Estimates / Invoices pipelines and the All Work overview (Production area).
 * Read only: every stage is derived from the record's real status, so sends,
 * approvals and payments made anywhere in the app show up on the next fetch.
 *
 *   GET /api/production/pipelines?board=estimates|invoices|all
 *       &search=&from=YYYY-MM-DD&to=YYYY-MM-DD&closedDays=90
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'production.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const sp = request.nextUrl.searchParams
  const board = sp.get('board') || 'estimates'
  if (!['estimates', 'invoices', 'all'].includes(board)) {
    return NextResponse.json({ error: 'Unknown board' }, { status: 400 })
  }
  const parseDay = (v: string | null, endOfDay = false) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
    const d = new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const closedDays = Number(sp.get('closedDays'))
  const query = {
    search: sp.get('search') || '',
    from: parseDay(sp.get('from')),
    to: parseDay(sp.get('to'), true),
    closedDays: Number.isFinite(closedDays) && closedDays > 0 ? Math.min(closedDays, 3650) : undefined,
  }

  try {
    const [config, canViewEstimates, canViewInvoices, canEditEstimates, canEditInvoices] = await Promise.all([
      getPipelineConfigForTenant(user.tenantId),
      hasPermission(user.id, user.tenantId, 'estimates.view'),
      hasPermission(user.id, user.tenantId, 'invoices.view'),
      hasPermission(user.id, user.tenantId, 'estimates.edit'),
      hasPermission(user.id, user.tenantId, 'invoices.edit'),
    ])

    if (board === 'estimates' && !canViewEstimates) {
      return NextResponse.json({ error: 'You do not have permission to view estimates' }, { status: 403 })
    }
    if (board === 'invoices' && !canViewInvoices) {
      return NextResponse.json({ error: 'You do not have permission to view invoices' }, { status: 403 })
    }

    let items: PipelineItem[] = []
    if (board === 'estimates') {
      items = await loadEstimatePipeline(user, query, config, canEditEstimates)
    } else if (board === 'invoices') {
      items = await loadInvoicePipeline(user, query, config, canEditInvoices)
    } else {
      // All Work: only the record types this person may see, and the company chose to include.
      const [jobs, estimates, invoices] = await Promise.all([
        config.allWork.jobs ? loadJobsForAllWork(user, query) : Promise.resolve([]),
        config.allWork.estimates && canViewEstimates
          ? loadEstimatePipeline(user, query, config, canEditEstimates)
          : Promise.resolve([]),
        config.allWork.invoices && canViewInvoices
          ? loadInvoicePipeline(user, query, config, canEditInvoices)
          : Promise.resolve([]),
      ])
      items = [...jobs, ...estimates, ...invoices]
    }

    return NextResponse.json({
      items,
      config,
      access: { estimates: canViewEstimates, invoices: canViewInvoices },
    })
  } catch (error) {
    console.error('Get production pipelines error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
