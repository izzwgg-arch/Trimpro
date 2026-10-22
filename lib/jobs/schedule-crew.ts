import { prisma } from '@/lib/prisma'

/**
 * Scheduling someone on a job makes them part of its crew, as a Field Worker. Anyone
 * already on the crew keeps the role they have; nobody else is touched.
 */
export async function ensureScheduledCrewMember(jobId: string, userId: string): Promise<void> {
  try {
    await prisma.jobAssignment.upsert({
      where: { jobId_userId: { jobId, userId } },
      update: {},
      create: { jobId, userId, role: 'FIELD_WORKER' },
    })
  } catch (error) {
    console.error('Add scheduled person to job crew failed:', error)
  }
}
