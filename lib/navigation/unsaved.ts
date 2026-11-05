'use client'

/**
 * Tiny shared store for the "unsaved changes" guard.
 *
 * The <UnsavedChangesGuard> component owns the DOM listeners and renders the
 * centered confirm dialog; other code (e.g. smartBack) can ask to leave via
 * confirmLeave() and await the user's answer. Keeping the state in a module —
 * not React context — lets plain helper functions consult it too.
 */
type Listener = () => void

let dirty = false
let promptOpen = false
let resolver: ((leave: boolean) => void) | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

export const unsavedChanges = {
  isDirty: () => dirty,

  setDirty(value: boolean) {
    if (dirty === value) return
    dirty = value
    emit()
  },

  isPromptOpen: () => promptOpen,

  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  /**
   * Ask the user whether to leave. Resolves true to proceed, false to stay.
   * No-ops to true when nothing is unsaved.
   */
  confirmLeave(): Promise<boolean> {
    if (!dirty) return Promise.resolve(true)
    // Collapse any dialog already open into a "stay" so we never leak a promise.
    if (resolver) {
      resolver(false)
      resolver = null
    }
    promptOpen = true
    emit()
    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  },

  /** Called by the dialog buttons. */
  resolvePrompt(leave: boolean) {
    if (!promptOpen) return
    promptOpen = false
    const r = resolver
    resolver = null
    emit()
    if (r) r(leave)
  },
}
