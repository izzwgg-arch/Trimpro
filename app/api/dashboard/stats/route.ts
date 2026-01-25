import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const now = new Date()

  try {
    // Date ranges
    const todayStart = startOfDay(now)
    const todayEnd = endOfDay(now)
    const weekStart = startOfWeek(now, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
    const monthStart = startOfMonth(now)
    const monthEnd = endOfMonth(now)
    const lastMonthStart = startOfMonth(subMonths(now, 1))
    const lastMonthEnd = endOfMonth(subMonths(now, 1))

    // Revenue metrics
    const [totalRevenue, todayRevenue, weekRevenue, monthRevenue, lastMonthRevenue] = await Promise.all([
      // Total revenue (all time)
      prisma.payment.aggregate({
        where: {
          invoice: {
            tenantId: user.tenantId,
          },
          status: 'COMPLETED',
        },
        _sum: {
          amount: true,
        },
      }),
      // Today's revenue
      prisma.payment.aggregate({
        where: {
          invoice: {
            tenantId: user.tenantId,
          },
          status: 'COMPLETED',
          processedAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      // Week's revenue
      prisma.payment.aggregate({
        where: {
          invoice: {
            tenantId: user.tenantId,
          },
          status: 'COMPLETED',
          processedAt: {
            gte: weekStart,
            lte: weekEnd,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      // Month's revenue
      prisma.payment.aggregate({
        where: {
          invoice: {
            tenantId: user.tenantId,
          },
          status: 'COMPLETED',
          processedAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      // Last month's revenue (for comparison)
      prisma.payment.aggregate({
        where: {
          invoice: {
            tenantId: user.tenantId,
          },
          status: 'COMPLETED',
          processedAt: {
            gte: lastMonthStart,
            lte: lastMonthEnd,
          },
        },
        _sum: {
          amount: true,
        },
      }),
    ])

    // Unpaid invoices
    const unpaidInvoices = await prisma.invoice.aggregate({
      where: {
        tenantId: user.tenantId,
        status: {
          in: ['SENT', 'VIEWED', 'PARTIAL', 'OVERDUE'],
        },
      },
      _sum: {
        balance: true,
      },
      _count: {
        id: true,
      },
    })

    // Active jobs
    const activeJobs = await prisma.job.count({
      where: {
        tenantId: user.tenantId,
        status: {
          in: ['SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'],
        },
      },
    })

    // Today's scheduled jobs
    const todaysJobs = await prisma.job.count({
      where: {
        tenantId: user.tenantId,
        scheduledStart: {
          gte: todayStart,
          lte: todayEnd,
        },
        status: {
          in: ['SCHEDULED', 'IN_PROGRESS'],
        },
      },
    })

    // Overdue invoices
    const overdueInvoices = await prisma.invoice.count({
      where: {
        tenantId: user.tenantId,
        status: 'OVERDUE',
      },
    })

    // Missed calls today
    const missedCallsToday = await prisma.call.count({
      where: {
        tenantId: user.tenantId,
        status: 'MISSED',
        startedAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    })

    // Unread SMS count
    const unreadSmsCount = await prisma.smsMessage.count({
      where: {
        tenantId: user.tenantId,
        direction: 'INBOUND',
        status: {
          in: ['DELIVERED', 'READ'],
        },
        // Note: We'd need a readAt field or isRead boolean for proper tracking
        // For now, this is a placeholder
      },
    })

    // Pending tasks assigned to user
    const pendingTasks = await prisma.task.count({
      where: {
        tenantId: user.tenantId,
        assigneeId: user.id,
        status: {
          in: ['TODO', 'IN_PROGRESS'],
        },
      },
    })

    // Open issues
    const openIssues = await prisma.issue.count({
      where: {
        tenantId: user.tenantId,
        status: {
          in: ['OPEN', 'IN_PROGRESS'],
        },
      },
    })

    // Recent payments (for payment received panel)
    const recentPayments = await prisma.payment.findMany({
      where: {
        invoice: {
          tenantId: user.tenantId,
        },
        status: 'COMPLETED',
        processedAt: {
          gte: subDays(now, 1), // Last 24 hours
        },
      },
      include: {
        invoice: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        processedAt: 'desc',
      },
      take: 10,
    })

    // Recent activity
    const recentActivity = await prisma.activity.findMany({
      where: {
        tenantId: user.tenantId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    })

    // Calculate revenue growth
    const monthRevenueNum = Number(monthRevenue._sum.amount || 0)
    const lastMonthRevenueNum = Number(lastMonthRevenue._sum.amount || 0)
    const revenueGrowth = lastMonthRevenueNum > 0
      ? ((monthRevenueNum - lastMonthRevenueNum) / lastMonthRevenueNum) * 100
      : 0

    return NextResponse.json({
      kpis: {
        totalRevenue: Number(totalRevenue._sum.amount || 0),
        todayRevenue: Number(todayRevenue._sum.amount || 0),
        weekRevenue: Number(weekRevenue._sum.amount || 0),
        monthRevenue: monthRevenueNum,
        revenueGrowth: revenueGrowth.toFixed(1),
        unpaidInvoicesTotal: Number(unpaidInvoices._sum.balance || 0),
        unpaidInvoicesCount: unpaidInvoices._count.id,
        activeJobs,
        todaysJobs,
        overdueInvoices,
        missedCallsToday,
        unreadSmsCount,
        pendingTasks,
        openIssues,
      },
      recentPayments: recentPayments.map(p => ({
        id: p.id,
        amount: Number(p.amount),
        clientName: p.invoice.client.name,
        invoiceNumber: p.invoice.invoiceNumber,
        processedAt: p.processedAt,
      })),
      recentActivity: recentActivity.map(a => ({
        id: a.id,
        type: a.type,
        description: a.description,
        userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : null,
        clientName: a.client?.name,
        jobTitle: a.job?.title,
        createdAt: a.createdAt,
      })),
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
