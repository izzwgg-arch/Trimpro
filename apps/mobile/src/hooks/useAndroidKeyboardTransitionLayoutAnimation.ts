import { useEffect, useRef } from 'react'
import { LayoutAnimation, Platform, UIManager } from 'react-native'
import { KeyboardEvents } from 'react-native-keyboard-controller'

const DEFAULT_MS = 280
const MIN_MS = 220
const MAX_MS = 320

function configureNextKeyboardLayoutAnimation(durationMs?: number) {
  const raw = typeof durationMs === 'number' && durationMs > 0 ? durationMs : DEFAULT_MS
  const duration = Math.min(Math.max(Math.round(raw), MIN_MS), MAX_MS)

  LayoutAnimation.configureNext({
    duration,
    update: {
      type: LayoutAnimation.Types.easeInEaseOut,
    },
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  })
}

/**
 * Android: align the next layout pass with the keyboard transition so any React-driven
 * layout eases instead of snapping.
 *
 * Uses KeyboardController `keyboardWillShow` / `keyboardWillHide` when the native module
 * emits them; falls back to `keyboardDidShow` / `keyboardDidHide` only if the matching
 * "will" event did not fire (avoids double `configureNext` in one transition).
 *
 * Pair with `softwareKeyboardLayoutMode: "pan"`: with `resize`, the window height changes
 * during the IME animation and react-native-keyboard-controller's KeyboardAvoidingView
 * re-renders from `windowDidResize` while `keyboard.progress` updates — two timing sources
 * and visible jitter. Pan keeps window size stable so padding tracks the keyboard only.
 */
export function useAndroidKeyboardTransitionLayoutAnimation() {
  const openWillSeen = useRef(false)
  const closeWillSeen = useRef(false)

  useEffect(() => {
    if (Platform.OS !== 'android') return

    const enable = UIManager.setLayoutAnimationEnabledExperimental
    if (typeof enable === 'function') {
      enable(true)
    }

    const sub = [
      KeyboardEvents.addListener('keyboardWillShow', (e) => {
        closeWillSeen.current = false
        openWillSeen.current = true
        configureNextKeyboardLayoutAnimation(e.duration)
      }),
      KeyboardEvents.addListener('keyboardDidShow', (e) => {
        if (openWillSeen.current) {
          openWillSeen.current = false
          return
        }
        configureNextKeyboardLayoutAnimation(e.duration)
      }),
      KeyboardEvents.addListener('keyboardWillHide', (e) => {
        openWillSeen.current = false
        closeWillSeen.current = true
        configureNextKeyboardLayoutAnimation(e.duration)
      }),
      KeyboardEvents.addListener('keyboardDidHide', (e) => {
        if (closeWillSeen.current) {
          closeWillSeen.current = false
          return
        }
        configureNextKeyboardLayoutAnimation(e.duration)
      }),
    ]

    return () => {
      sub.forEach((s) => s.remove())
    }
  }, [])
}
