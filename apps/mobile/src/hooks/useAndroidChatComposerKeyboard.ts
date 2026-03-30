/**
 * Android chat thread: bottom padding so the composer aligns with the IME after adjustResize.
 *
 * With `softwareKeyboardLayoutMode: "resize"`, the window height already reflects the area
 * above the keyboard. Extra padding lifts the composer and causes a visible gap (double lift).
 * We measure the composer dock with `measureInWindow` and compare to
 * `Dimensions.get('window').height`, then set padding so the bottom edge matches:
 *
 *   P_next = max(0, P_now + composerBottom - windowHeight)
 *
 * On `keyboardDidHide`, padding clears in one step (no Keyboard.scheduleLayoutAnimation) so
 * native IME teardown does not fight a second layout animation.
 *
 * iOS: returns 0; use KeyboardAvoidingView on the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Dimensions, Keyboard, Platform, type View } from 'react-native'

export function useAndroidChatComposerKeyboardPadding(composerDockRef: RefObject<View | null>): number {
  const [threadPaddingBottom, setThreadPaddingBottom] = useState(0)
  const paddingRef = useRef(0)
  const keyboardOpenRef = useRef(false)

  const applyFromMeasure = useCallback(
    (eventLabel: string) => {
      if (Platform.OS !== 'android') return
      const node = composerDockRef.current
      if (!node) return

      const winH = Dimensions.get('window').height
      const Pnow = paddingRef.current

      node.measureInWindow((x, y, w, h) => {
        const composerBottom = y + h
        const pRaw = Pnow + composerBottom - winH
        const Pnext = Math.max(0, pRaw)
        const changed = Math.abs(Pnext - Pnow) > 0.05

        if (changed) {
          paddingRef.current = Pnext
          setThreadPaddingBottom(Pnext)
          if (!eventLabel.endsWith('→reconcile')) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                applyFromMeasure(`${eventLabel}→reconcile`)
              })
            })
          }
        }
      })
    },
    [composerDockRef]
  )

  const scheduleApply = useCallback(
    (eventLabel: string) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          applyFromMeasure(eventLabel)
        })
      })
    },
    [applyFromMeasure]
  )

  useEffect(() => {
    paddingRef.current = threadPaddingBottom
  }, [threadPaddingBottom])

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return
    }

    const onShow = () => {
      keyboardOpenRef.current = true
      scheduleApply('keyboardDidShow')
    }

    const onHide = () => {
      keyboardOpenRef.current = false
      if (paddingRef.current !== 0) {
        paddingRef.current = 0
        setThreadPaddingBottom(0)
      }
    }

    const dimSub = Dimensions.addEventListener('change', ({ window }) => {
      if (!keyboardOpenRef.current) return
      scheduleApply('Dimensions.change')
    })

    const showSub = Keyboard.addListener('keyboardDidShow', onShow)
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide)

    return () => {
      dimSub.remove()
      showSub.remove()
      hideSub.remove()
    }
  }, [scheduleApply, composerDockRef])

  return Platform.OS === 'android' ? threadPaddingBottom : 0
}
