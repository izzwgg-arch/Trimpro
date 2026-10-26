'use client'

import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Video } from 'lucide-react'
import { callFetch, callJson, startTone } from '@/lib/video-calls/client'

type IncomingCall = {
  id: string
  video: boolean
  otherUser: { id: string; name: string; avatar: string | null }
}

const POLL_MS = 3000

/** Rings in the dashboard when someone calls this user, with Answer / Decline. */
export function IncomingCallWatcher() {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const handledRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let stopped = false
    const poll = async () => {
      if (stopped) return
      try {
        const res = await callFetch('/api/video-calls/incoming')
        if (res.status === 403) {
          stopped = true // no messaging access, so nobody can call this user
          return
        }
        if (!res.ok) return
        const data = (await res.json()) as { calls: IncomingCall[] }
        if (stopped) return
        const next = data.calls.find((c) => !handledRef.current.has(c.id)) || null
        setIncoming((prev) => (prev?.id === next?.id ? prev : next))
      } catch {
        // offline for a moment; try again next tick
      }
    }
    void poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!incoming) return
    return startTone('incoming')
  }, [incoming])

  if (!incoming) return null

  const dismiss = () => {
    handledRef.current.add(incoming.id)
    setIncoming(null)
  }

  const answer = async () => {
    // Open the window inside the click so the popup isn't blocked, then answer.
    const popup = window.open('about:blank', 'trimpro-call', 'width=980,height=720')
    const id = incoming.id
    dismiss()
    try {
      await callJson(`/api/video-calls/${id}`, { action: 'answer' })
      if (popup) popup.location.href = `/call/${id}`
      else window.location.href = `/call/${id}`
    } catch (error: any) {
      popup?.close()
      alert(error?.message || 'This call has already ended')
    }
  }

  const decline = () => {
    const id = incoming.id
    dismiss()
    void callJson(`/api/video-calls/${id}`, { action: 'decline' }).catch(() => null)
  }

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-80 rounded-2xl bg-[#0b141a] text-white shadow-2xl ring-1 ring-black/20 p-4 animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-[#2e4a59] flex items-center justify-center text-lg font-semibold overflow-hidden animate-pulse">
          {incoming.otherUser.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={incoming.otherUser.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            incoming.otherUser.name.slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <div className="font-semibold truncate">{incoming.otherUser.name}</div>
          <div className="text-sm text-white/70">{incoming.video ? 'Incoming video call' : 'Incoming call'}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={decline} className="flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 py-2.5 text-sm font-medium">
          <PhoneOff className="w-4 h-4" /> Decline
        </button>
        <button onClick={() => void answer()} className="flex items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 py-2.5 text-sm font-medium">
          {incoming.video ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />} Answer
        </button>
      </div>
    </div>
  )
}
