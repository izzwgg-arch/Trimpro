'use client'

import { useSearchParams } from 'next/navigation'
import { ScheduleForm } from '@/components/schedule/ScheduleForm'

export default function NewSchedulePage() {
  const searchParams = useSearchParams()
  return <ScheduleForm initialJobId={searchParams.get('jobId')} />
}
