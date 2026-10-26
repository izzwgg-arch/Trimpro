// Lets any screen start or open a video call; VideoCallHost (mounted once in AppRoot) does the work.

export type CallTarget = { conversationId?: string; calleeId?: string }

export type CallRequest =
  | { type: 'start'; target: CallTarget; video: boolean }
  | { type: 'open'; callId: string }
  | { type: 'check' }

let listener: ((request: CallRequest) => void) | null = null

export function setVideoCallListener(next: ((request: CallRequest) => void) | null) {
  listener = next
}

/** Call someone from a direct chat (or by user id). */
export function startVideoCall(target: CallTarget, video = true) {
  listener?.({ type: 'start', target, video })
}

/** A call push was tapped: ring if it's still ringing, rejoin if it's live. */
export function openVideoCall(callId: string) {
  listener?.({ type: 'open', callId })
}

/** A call push arrived while the app is open: look for the ringing call right away. */
export function checkIncomingCalls() {
  listener?.({ type: 'check' })
}
