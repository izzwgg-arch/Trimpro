'use client'

import { useParams } from 'next/navigation'
import { ScheduleForm } from '@/components/schedule/ScheduleForm'

export default function EditSchedulePage() {
  const params = useParams<{ id: string }>()
  return <ScheduleForm scheduleId={String(params?.id || '')} />
}
