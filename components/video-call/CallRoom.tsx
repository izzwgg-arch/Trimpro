'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff, Volume2 } from 'lucide-react'
import { callFetch, callJson, isInApp, postToApp, readCallStream, startTone } from '@/lib/video-calls/client'
import { formatCallDuration } from '@/lib/video-calls/format'

type CallInfo = {
  id: string
  status: 'RINGING' | 'ACTIVE' | 'ENDED' | 'DECLINED' | 'MISSED' | 'CANCELED'
  video: boolean
  role: 'caller' | 'callee'
  otherUser: { id: string; name: string; avatar: string | null }
  answeredAt: string | null
}

type Phase = 'loading' | 'incoming' | 'calling' | 'connecting' | 'connected' | 'reconnecting' | 'ended'

const FINAL = ['ENDED', 'DECLINED', 'MISSED', 'CANCELED']
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

function videoConstraints(facing: 'user' | 'environment'): MediaTrackConstraints {
  return { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
}

function endReason(status: string, role: 'caller' | 'callee') {
  if (status === 'DECLINED') return role === 'caller' ? 'Call declined' : 'Call ended'
  if (status === 'MISSED') return role === 'caller' ? 'No answer' : 'Missed call'
  if (status === 'CANCELED') return role === 'caller' ? 'Call canceled' : 'The caller hung up'
  return 'Call ended'
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2) || '?').toUpperCase()
}

const randomId = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

/**
 * One side of a 1-to-1 WebRTC call. Media flows peer-to-peer (or through our TURN server);
 * our API only passes the offer/answer/ICE messages and the call status.
 * Only the caller ever makes offers, so the two sides never offer at the same time.
 */
export function CallRoom({ callId }: { callId: string }) {
  const [call, setCall] = useState<CallInfo | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState('')
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [canFlip, setCanFlip] = useState(false)
  const [remoteVideo, setRemoteVideo] = useState(false)
  const [peerCamOff, setPeerCamOff] = useState(false)
  const [peerMuted, setPeerMuted] = useState(false)
  const [localVideo, setLocalVideo] = useState(false)
  const [soundBlocked, setSoundBlocked] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [connectedAt, setConnectedAt] = useState<number | null>(null)

  const remoteRef = useRef<HTMLVideoElement | null>(null)
  const localRef = useRef<HTMLVideoElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const acceptRef = useRef<((accepted: boolean) => void) | null>(null)
  const hangUpRef = useRef<() => void>(() => {})
  // Tells the other side our camera/mic state (a disabled camera would otherwise just look black).
  const sendMediaRef = useRef<() => void>(() => {})
  const micOnRef = useRef(true)
  const camOnRef = useRef(true)

  useEffect(() => {
    let disposed = false
    let ended = false
    const abort = new AbortController()
    let role: 'caller' | 'callee' = 'caller'
    let isVideo = true
    let iceServers: RTCIceServer[] = []
    let after = 0
    let session = ''
    let pending: RTCIceCandidateInit[] = []
    let early: Array<{ session: string; candidate: RTCIceCandidateInit }> = []
    let outChain: Promise<unknown> = Promise.resolve()
    let resolveMedia: () => void = () => {}
    let inChain: Promise<unknown> = new Promise<void>((r) => (resolveMedia = r))
    let sawActive = false
    let stopTone = () => {}
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    let lostTimer: ReturnType<typeof setTimeout> | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    // Answered but the two devices can't reach each other yet (e.g. a network that blocks calls).
    let slowTimer: ReturnType<typeof setTimeout> | null = null
    let giveUpTimer: ReturnType<typeof setTimeout> | null = null
    const STILL_CONNECTING_NOTICE = 'Still connecting… If this keeps happening, try Wi-Fi or mobile data instead.'

    const clearTimers = () => {
      if (restartTimer) clearTimeout(restartTimer)
      if (lostTimer) clearTimeout(lostTimer)
      if (slowTimer) clearTimeout(slowTimer)
      if (giveUpTimer) clearTimeout(giveUpTimer)
      restartTimer = lostTimer = slowTimer = giveUpTimer = null
    }

    // Signals go out one at a time so the other side reads them in the order they were made.
    const send = (kind: string, payload: unknown) => {
      outChain = outChain
        .then(() => callJson(`/api/video-calls/${callId}/signal`, { kind, payload }))
        .catch((error) => console.warn('call signal failed', kind, error))
      return outChain
    }

    const finish = (status: string, message?: string) => {
      if (ended) return
      ended = true
      clearTimers()
      if (fallbackTimer) clearTimeout(fallbackTimer)
      stopTone()
      abort.abort()
      pcRef.current?.close()
      pcRef.current = null
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      acceptRef.current?.(false)
      setReason(message || endReason(status, role))
      setPhase('ended')
      postToApp({ type: 'call-ended' })
      if (!isInApp() && window.opener) setTimeout(() => window.close(), 2500)
    }

    const hangUp = () => {
      void callJson(`/api/video-calls/${callId}`, { action: 'end' }).catch(() => null)
      finish('ENDED', 'Call ended')
    }
    hangUpRef.current = hangUp
    sendMediaRef.current = () => {
      if (!ended && sawActive) void send('media', { video: camOnRef.current, audio: micOnRef.current })
    }

    const onConnectionChange = (pc: RTCPeerConnection) => {
      if (pc !== pcRef.current || ended) return
      const state = pc.connectionState
      if (state === 'connected') {
        clearTimers()
        stopTone()
        setNotice((n) => (n === STILL_CONNECTING_NOTICE ? '' : n))
        setPhase('connected')
        setConnectedAt((prev) => prev ?? Date.now())
        if (!camOnRef.current || !micOnRef.current) sendMediaRef.current()
        return
      }
      if (state === 'disconnected' || state === 'failed') {
        setPhase('reconnecting')
        if (role === 'caller' && !restartTimer) {
          restartTimer = setTimeout(
            () => {
              restartTimer = null
              void negotiate(true)
            },
            state === 'failed' ? 0 : 2500
          )
        }
        if (!lostTimer) lostTimer = setTimeout(() => hangUp(), 30_000)
      }
    }

    const newPeer = () => {
      pcRef.current?.close()
      const pc = new RTCPeerConnection({ iceServers })
      const local = localStreamRef.current
      local?.getTracks().forEach((t) => pc.addTrack(t, local))
      if (role === 'caller') {
        if (!local?.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' })
        if (isVideo && !local?.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' })
      }
      const mySession = session
      pc.onicecandidate = (e) => {
        if (e.candidate) void send('ice', { session: mySession, candidate: e.candidate.toJSON() })
      }
      pc.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track])
        const el = remoteRef.current
        if (el && el.srcObject !== stream) {
          el.srcObject = stream
          el.play().then(() => setSoundBlocked(false)).catch(() => setSoundBlocked(true))
        }
        if (e.track.kind === 'video') {
          setRemoteVideo(!e.track.muted)
          e.track.onmute = () => setRemoteVideo(false)
          e.track.onunmute = () => setRemoteVideo(true)
          e.track.onended = () => setRemoteVideo(false)
        }
      }
      pc.onconnectionstatechange = () => onConnectionChange(pc)
      pcRef.current = pc
      pending = []
      return pc
    }

    const flushPending = async (pc: RTCPeerConnection) => {
      const list = pending
      pending = []
      for (const c of list) await pc.addIceCandidate(c).catch(() => null)
    }

    // Caller only: a fresh session (new connection) or an ICE restart on the current one.
    const negotiate = async (iceRestart: boolean) => {
      if (ended || role !== 'caller') return
      if (fallbackTimer) {
        clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      let pc = pcRef.current
      if (!iceRestart || !pc) {
        session = randomId()
        pc = newPeer()
      }
      const offer = await pc.createOffer({ iceRestart })
      await pc.setLocalDescription(offer)
      await send('offer', { session, type: offer.type, sdp: offer.sdp })
    }

    const handleSignal = async (kind: string, payload: any) => {
      if (ended) return
      if (kind === 'ready' && role === 'caller') return negotiate(false)
      if (kind === 'media') {
        setPeerCamOff(payload?.video === false)
        setPeerMuted(payload?.audio === false)
        return
      }

      if (kind === 'offer' && role === 'callee') {
        let pc = pcRef.current
        if (!pc || payload.session !== session) {
          session = payload.session
          pc = newPeer()
          pending = early.filter((e) => e.session === session).map((e) => e.candidate)
          early = []
        }
        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        await flushPending(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await send('answer', { session, type: answer.type, sdp: answer.sdp })
        return
      }

      if (kind === 'answer' && role === 'caller') {
        const pc = pcRef.current
        if (!pc || payload.session !== session || pc.signalingState !== 'have-local-offer') return
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        await flushPending(pc)
        return
      }

      if (kind === 'ice') {
        const pc = pcRef.current
        if (pc && payload.session === session) {
          if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate).catch(() => null)
          else pending.push(payload.candidate)
        } else if (role === 'callee') {
          early.push({ session: payload.session, candidate: payload.candidate })
        }
      }
    }

    const onState = (next: CallInfo) => {
      setCall(next)
      if (FINAL.includes(next.status)) return finish(next.status)
      if (next.status === 'RINGING') {
        if (next.role === 'caller') setPhase('calling')
        return
      }
      // ACTIVE
      stopTone()
      setPhase((p) => (p === 'connected' || p === 'reconnecting' ? p : 'connecting'))
      if (!sawActive) {
        sawActive = true
        // Never sit on "Connecting…" forever: retry the network path, then end with a clear reason.
        slowTimer = setTimeout(() => {
          slowTimer = null
          if (ended || pcRef.current?.connectionState === 'connected') return
          setNotice(STILL_CONNECTING_NOTICE)
          if (role === 'caller') void negotiate(!!pcRef.current)
        }, 15_000)
        giveUpTimer = setTimeout(() => {
          giveUpTimer = null
          if (ended || pcRef.current?.connectionState === 'connected') return
          void callJson(`/api/video-calls/${callId}`, { action: 'end' }).catch(() => null)
          finish('ENDED', "Couldn't connect the call. The network may be blocking it — please try again.")
        }, 50_000)
        // If the other screen never says it's ready, offer anyway after a few seconds.
        if (role === 'caller') {
          void inChain.then(() => {
            if (!pcRef.current && !ended) fallbackTimer = setTimeout(() => void negotiate(false), 8000)
          })
        }
      }
    }

    const onEvent = (event: string, data: any) => {
      if (event === 'state') onState(data)
      else if (event === 'signal') {
        after = Math.max(after, Number(data.id) || 0)
        inChain = inChain.then(() => handleSignal(data.kind, data.payload)).catch((e) => console.warn('call signal error', e))
      }
    }

    const listen = async () => {
      while (!ended && !disposed) {
        try {
          await readCallStream(`/api/video-calls/${callId}/stream?after=${after}`, onEvent, abort.signal)
        } catch {
          if (abort.signal.aborted) return
        }
        if (ended || disposed) return
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    const getMedia = async (video: boolean) => {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: video ? videoConstraints('user') : false })
      } catch (error) {
        if (video) {
          try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: AUDIO })
            setNotice('Camera not available, so you are on audio only')
            return audioOnly
          } catch {}
        }
        setNotice('Microphone and camera are blocked. Allow them to be heard and seen.')
        return null
      }
    }

    const run = async () => {
      let data: { call: CallInfo; iceServers: RTCIceServer[]; lastSignalId: number }
      try {
        data = await callJson(`/api/video-calls/${callId}`)
      } catch (error: any) {
        setReason(error?.message || 'Call not found')
        setPhase('ended')
        postToApp({ type: 'call-ended' })
        return
      }
      if (disposed) return
      role = data.call.role
      isVideo = data.call.video
      iceServers = data.iceServers
      after = data.lastSignalId || 0
      setCall(data.call)
      setCamOn(data.call.video)
      camOnRef.current = data.call.video
      if (FINAL.includes(data.call.status)) return finish(data.call.status)

      // The person being called and not yet answered: ask first.
      if (role === 'callee' && data.call.status === 'RINGING') {
        setPhase('incoming')
        stopTone = startTone('incoming')
        void listen()
        const accepted = await new Promise<boolean>((resolve) => (acceptRef.current = resolve))
        acceptRef.current = null
        stopTone()
        if (!accepted || ended) return
        try {
          await callJson(`/api/video-calls/${callId}`, { action: 'answer' })
        } catch (error: any) {
          return finish('ENDED', error?.message || 'This call has already ended')
        }
        setPhase('connecting')
      } else {
        if (role === 'caller' && data.call.status === 'RINGING') {
          setPhase('calling')
          stopTone = startTone('outgoing')
        } else setPhase('connecting')
        void listen()
      }

      const stream = await getMedia(data.call.video)
      if (disposed || ended) {
        stream?.getTracks().forEach((t) => t.stop())
        return
      }
      localStreamRef.current = stream
      setLocalVideo(!!stream?.getVideoTracks().length)
      if (localRef.current && stream) localRef.current.srcObject = stream
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1)
      } catch {}
      resolveMedia()

      if (role === 'callee') void send('ready', {})
      else if (data.call.status === 'ACTIVE') void negotiate(false) // caller's screen was reopened mid-call
    }

    void run()

    const onPageHide = () => {
      if (ended || isInApp()) return
      const token = localStorage.getItem('accessToken') || ''
      void fetch(`/api/video-calls/${callId}`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'end' }),
      }).catch(() => null)
    }
    window.addEventListener('pagehide', onPageHide)

    return () => {
      disposed = true
      window.removeEventListener('pagehide', onPageHide)
      if (!ended) {
        ended = true
        clearTimers()
        if (fallbackTimer) clearTimeout(fallbackTimer)
        stopTone()
        abort.abort()
        pcRef.current?.close()
        pcRef.current = null
        localStreamRef.current?.getTracks().forEach((t) => t.stop())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId])

  useEffect(() => {
    if (!connectedAt || phase === 'ended') return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - connectedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [connectedAt, phase])

  useEffect(() => {
    if (localRef.current && localStreamRef.current) localRef.current.srcObject = localStreamRef.current
  }, [localVideo, phase])

  const toggleMic = () => {
    const next = !micOn
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next))
    micOnRef.current = next
    setMicOn(next)
    sendMediaRef.current()
  }

  const toggleCam = () => {
    const next = !camOn
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next))
    camOnRef.current = next
    setCamOn(next)
    sendMediaRef.current()
  }

  const flipCamera = useCallback(async () => {
    const stream = localStreamRef.current
    const old = stream?.getVideoTracks()[0]
    if (!stream || !old) return
    const nextFacing = facing === 'user' ? 'environment' : 'user'
    try {
      old.stop()
      const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(nextFacing) })
      const track = fresh.getVideoTracks()[0]
      track.enabled = camOn
      stream.removeTrack(old)
      stream.addTrack(track)
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video' || s.track === old)
      await sender?.replaceTrack(track)
      if (localRef.current) localRef.current.srcObject = stream
      setFacing(nextFacing)
    } catch {
      setNotice('Could not switch camera')
    }
  }, [facing, camOn])

  const unblockSound = () => {
    remoteRef.current?.play().then(() => setSoundBlocked(false)).catch(() => null)
  }

  const name = call?.otherUser.name || ''
  const statusText =
    phase === 'loading' ? 'Loading…'
    : phase === 'incoming' ? (call?.video ? 'Incoming video call' : 'Incoming call')
    : phase === 'calling' ? 'Calling…'
    : phase === 'connecting' ? 'Connecting…'
    : phase === 'reconnecting' ? 'Reconnecting…'
    : phase === 'connected' ? formatCallDuration(elapsed)
    : reason
  const showRemoteVideo = remoteVideo && !peerCamOff && call?.video !== false && phase !== 'ended'
  const live = phase === 'connected' || phase === 'reconnecting'
  const peerNote = live ? [peerCamOff && call?.video ? 'Camera off' : '', peerMuted ? 'Muted' : ''].filter(Boolean).join(' · ') : ''

  return (
    <div
      className="fixed inset-0 bg-[#0b141a] text-white overflow-hidden select-none"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        className={`absolute inset-0 w-full h-full object-cover sm:object-contain bg-black transition-opacity ${showRemoteVideo ? 'opacity-100' : 'opacity-0'}`}
      />

      {!showRemoteVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="w-28 h-28 rounded-full bg-[#2e4a59] flex items-center justify-center text-4xl font-semibold overflow-hidden">
            {call?.otherUser.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={call.otherUser.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              initials(name || '?')
            )}
          </div>
          <div className="text-2xl font-semibold">{name}</div>
          <div className="text-white/70">{statusText}</div>
          {peerNote && <div className="flex items-center gap-1.5 text-sm text-white/60">{peerMuted && <MicOff className="w-4 h-4" />}{peerNote}</div>}
        </div>
      )}

      {showRemoteVideo && (
        <div className="absolute top-0 inset-x-0 p-4 pt-6 bg-gradient-to-b from-black/60 to-transparent">
          <div className="text-lg font-semibold">{name}</div>
          <div className="text-sm text-white/80">{statusText}</div>
          {peerMuted && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-xs">
              <MicOff className="w-3.5 h-3.5" /> Muted
            </div>
          )}
        </div>
      )}

      {localVideo && phase !== 'ended' && phase !== 'incoming' && (
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className={`absolute right-4 bottom-32 w-28 h-40 sm:w-56 sm:h-36 rounded-xl object-cover bg-black/60 border border-white/20 shadow-lg ${
            facing === 'user' ? '-scale-x-100' : ''
          } ${camOn ? '' : 'opacity-0'}`}
        />
      )}

      {notice && phase !== 'ended' && (
        <div className="absolute top-24 inset-x-4 mx-auto max-w-md rounded-lg bg-black/70 px-4 py-2 text-center text-sm">{notice}</div>
      )}

      {soundBlocked && phase !== 'ended' && (
        <button
          onClick={unblockSound}
          className="absolute top-36 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-white text-[#0b141a] px-4 py-2 text-sm font-medium shadow"
        >
          <Volume2 className="w-4 h-4" /> Tap to hear {name || 'the other person'}
        </button>
      )}

      <div className="absolute bottom-0 inset-x-0 pb-8 pt-6 flex items-center justify-center gap-5 bg-gradient-to-t from-black/60 to-transparent">
        {phase === 'incoming' ? (
          <>
            <RoundButton label="Decline" className="bg-red-600 hover:bg-red-700" onClick={() => {
              void callJson(`/api/video-calls/${callId}`, { action: 'decline' }).catch(() => null)
              acceptRef.current?.(false)
            }}>
              <PhoneOff className="w-7 h-7" />
            </RoundButton>
            <RoundButton label="Answer" className="bg-green-600 hover:bg-green-700" onClick={() => acceptRef.current?.(true)}>
              {call?.video ? <Video className="w-7 h-7" /> : <Phone className="w-7 h-7" />}
            </RoundButton>
          </>
        ) : phase === 'ended' ? (
          !isInApp() && (
            <button onClick={() => window.close()} className="rounded-full bg-white/15 hover:bg-white/25 px-6 py-3 text-sm font-medium">
              Close
            </button>
          )
        ) : (
          <>
            <RoundButton label={micOn ? 'Mute' : 'Unmute'} className={micOn ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-[#0b141a]'} onClick={toggleMic}>
              {micOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </RoundButton>
            {localVideo && (
              <RoundButton label={camOn ? 'Camera off' : 'Camera on'} className={camOn ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-[#0b141a]'} onClick={toggleCam}>
                {camOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
              </RoundButton>
            )}
            {localVideo && canFlip && (
              <RoundButton label="Flip camera" className="bg-white/15 hover:bg-white/25" onClick={() => void flipCamera()}>
                <SwitchCamera className="w-6 h-6" />
              </RoundButton>
            )}
            <RoundButton label="End call" className="bg-red-600 hover:bg-red-700" onClick={() => hangUpRef.current()}>
              <PhoneOff className="w-7 h-7" />
            </RoundButton>
          </>
        )}
      </div>
    </div>
  )
}

function RoundButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string
  className: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${className}`}
      >
        {children}
      </button>
      <span className="text-[11px] text-white/80">{label}</span>
    </div>
  )
}
