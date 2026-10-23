import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWebOrAnyMobilePermission } from '@/lib/authorization'
import { guardJob } from '@/lib/assignments/scope'
import { formatAddressParts } from '@/lib/address/parse'
import { mergeTakeoffConfig, type TakeoffConfig } from './config'

/** Web permission keys, plus the mobile keys that also allow each action from the app. */
export const TAKEOFF_PERMISSIONS = {
  view: { web: 'jobs.takeoffs.view', mobile: ['mobile.takeoffs.view', 'mobile.takeoffs.edit'] },
  create: { web: 'jobs.takeoffs.create', mobile: ['mobile.takeoffs.edit'] },
  edit: { web: 'jobs.takeoffs.edit', mobile: ['mobile.takeoffs.edit'] },
  delete: { web: 'jobs.takeoffs.delete', mobile: ['mobile.takeoffs.delete'] },
  settings: { web: 'jobs.takeoffs.settings', mobile: [] as string[] },
} as const

export type TakeoffAction = keyof typeof TAKEOFF_PERMISSIONS

export function requireTakeoffPermission(request: NextRequest, action: TakeoffAction) {
  const p = TAKEOFF_PERMISSIONS[action]
  return requireWebOrAnyMobilePermission(request, p.web, [...p.mobile])
}

export async function loadTakeoffConfig(tenantId: string): Promise<TakeoffConfig> {
  const row = await prisma.takeoffSettings.findUnique({ where: { tenantId }, select: { config: true } })
  return mergeTakeoffConfig(row?.config)
}

type User = { id: string; tenantId: string; role: string }

/** The job (in this tenant, visible to this person) or an error response. */
export async function loadJobForTakeoff(user: User, jobId: string) {
  const scopeError = await guardJob(user, jobId)
  if (scopeError) return { error: scopeError }
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId: user.tenantId },
    select: {
      id: true,
      jobNumber: true,
      title: true,
      client: { select: { id: true, name: true, companyName: true } },
      addresses: {
        where: { type: 'job_site' },
        select: { street: true, city: true, state: true, zipCode: true },
        take: 1,
      },
    },
  })
  if (!job) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
  return { job }
}

export const takeoffInclude = {
  doors: { orderBy: { sortOrder: 'asc' as const } },
  items: { orderBy: [{ category: 'asc' as const }, { sortOrder: 'asc' as const }] },
  job: {
    select: {
      id: true,
      jobNumber: true,
      title: true,
      client: { select: { id: true, name: true, companyName: true } },
      addresses: {
        where: { type: 'job_site' },
        select: { street: true, city: true, state: true, zipCode: true },
        take: 1,
      },
    },
  },
}

/** A takeoff in this tenant whose job this person may see, or an error response. */
export async function loadTakeoff(user: User, takeoffId: string) {
  const takeoff = await prisma.materialTakeoff.findFirst({
    where: { id: takeoffId, tenantId: user.tenantId },
    include: takeoffInclude,
  })
  if (!takeoff) return { error: NextResponse.json({ error: 'Takeoff not found' }, { status: 404 }) }
  const scopeError = await guardJob(user, takeoff.jobId)
  if (scopeError) return { error: NextResponse.json({ error: 'Takeoff not found' }, { status: 404 }) }
  return { takeoff }
}

async function userNames(ids: Array<string | null | undefined>) {
  const unique = Array.from(new Set(ids.filter(Boolean) as string[]))
  if (unique.length === 0) return new Map<string, string>()
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true },
  })
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]))
}

/** JSON shape sent to web and mobile. */
export async function serializeTakeoff(t: any) {
  const names = await userNames([t.createdById, t.updatedById])
  const job = t.job
  return {
    id: t.id,
    jobId: t.jobId,
    title: t.title || '',
    notes: t.notes || '',
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    createdBy: t.createdById ? { id: t.createdById, name: names.get(t.createdById) || '' } : null,
    updatedBy: t.updatedById ? { id: t.updatedById, name: names.get(t.updatedById) || '' } : null,
    job: job
      ? {
          id: job.id,
          jobNumber: job.jobNumber,
          title: job.title,
          customer: job.client ? job.client.companyName || job.client.name : '',
          clientId: job.client?.id || null,
          siteAddress: formatAddressParts(job.addresses?.[0] || null) || '',
        }
      : null,
    doors: (t.doors || []).map((d: any) => ({
      id: d.id,
      doorNumber: d.doorNumber,
      location: d.location || '',
      height: d.height || '',
      width: d.width || '',
      swing: d.swing || '',
      lock: d.lock || '',
      jamb: d.jamb || '',
      hinge: d.hinge || '',
      doorStyle: d.doorStyle || '',
      notes: d.notes || '',
    })),
    items: (t.items || []).map((i: any) => ({
      id: i.id,
      category: i.category,
      quantity: i.quantity === null ? null : Number(i.quantity),
      unit: i.unit || '',
      description: i.description || '',
      notes: i.notes || '',
    })),
  }
}
