'use client'

import { useParams } from 'next/navigation'
import { TakeoffEditor } from '@/components/takeoffs/TakeoffEditor'

export default function JobTakeoffPage() {
  const params = useParams<{ id: string; takeoffId: string }>()
  return <TakeoffEditor takeoffId={String(params?.takeoffId || '')} />
}
