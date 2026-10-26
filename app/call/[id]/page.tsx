import { CallRoom } from '@/components/video-call/CallRoom'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Call · Trim Pro' }

export default function CallPage({ params }: { params: { id: string } }) {
  return <CallRoom callId={params.id} />
}
