import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  PanResponder,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native'

type Props = {
  count: number
  index: number
  onIndexChange: (index: number) => void
  renderItem: (index: number) => React.ReactNode
  /** Turn swiping off (e.g. while an image is zoomed in or being drawn on). */
  locked?: boolean
  /** Small page dots along the bottom edge (only drawn for 2–12 items). */
  showIndicator?: boolean
  style?: StyleProp<ViewStyle>
}

const CAPTURE_DX = 18
const COMMIT_RATIO = 0.22
const COMMIT_VELOCITY = 0.45

/**
 * Finger-driven pager for attachments: drag left/right and the current item
 * follows your finger, then slides to the next/previous one (wrapping around).
 * Only the current item is mounted, so heavy content (WebViews, video) is never
 * rendered for neighbours.
 */
export function SwipePager({ count, index, onIndexChange, renderItem, locked, showIndicator = true, style }: Props) {
  const x = useRef(new Animated.Value(0)).current
  const widthRef = useRef(0)
  const animatingRef = useRef(false)
  const enterFromRef = useRef<number | null>(null)
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const safeIndex = count > 0 ? ((index % count) + count) % count : 0

  // The responder is created once, so it reads the latest props from a ref.
  const live = useRef({ count, index: safeIndex, locked: !!locked, onIndexChange })
  live.current = { count, index: safeIndex, locked: !!locked, onIndexChange }

  const springBack = () => {
    Animated.spring(x, { toValue: 0, bounciness: 0, useNativeDriver: true }).start()
  }

  const commit = (dir: 1 | -1) => {
    const w = widthRef.current || 1
    animatingRef.current = true
    Animated.timing(x, {
      toValue: -dir * w,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      const { count: n, index: i, onIndexChange: change } = live.current
      // The next item enters from the side the previous one did not leave to.
      enterFromRef.current = dir * w
      change((((i + dir) % n) + n) % n)
      // If the parent ignores the change, don't leave the content off-screen.
      fallbackTimer.current = setTimeout(() => {
        if (enterFromRef.current !== null) {
          enterFromRef.current = null
          x.setValue(0)
          animatingRef.current = false
        }
      }, 400)
    })
  }

  useEffect(() => {
    if (enterFromRef.current === null) return
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current)
    x.setValue(enterFromRef.current)
    enterFromRef.current = null
    Animated.timing(x, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      animatingRef.current = false
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex])

  useEffect(
    () => () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current)
    },
    []
  )

  const responder = useRef(
    PanResponder.create({
      // Capture only a deliberate, mostly-horizontal single-finger drag so taps,
      // vertical scrolls, pinch-zoom and drawing still reach the content.
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        !animatingRef.current &&
        live.current.count > 1 &&
        !live.current.locked &&
        g.numberActiveTouches === 1 &&
        Math.abs(g.dx) > CAPTURE_DX &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_e, g) => {
        x.setValue(g.dx)
      },
      onPanResponderRelease: (_e, g) => {
        const w = widthRef.current || 1
        const farEnough = Math.abs(g.dx) > w * COMMIT_RATIO
        const fastEnough = Math.abs(g.vx) > COMMIT_VELOCITY && Math.sign(g.vx) === Math.sign(g.dx)
        if (farEnough || fastEnough) commit(g.dx < 0 ? 1 : -1)
        else springBack()
      },
      onPanResponderTerminate: springBack,
      onPanResponderTerminationRequest: () => false,
    })
  ).current

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width
  }

  const dots = showIndicator && count > 1 && count <= 12

  return (
    <View style={[styles.root, style]} onLayout={onLayout} {...responder.panHandlers}>
      <Animated.View style={[styles.page, { transform: [{ translateX: x }] }]}>
        {count > 0 ? renderItem(safeIndex) : null}
      </Animated.View>
      {dots ? (
        <View style={styles.dots} pointerEvents="none">
          {Array.from({ length: count }).map((_, i) => (
            <View key={i} style={[styles.dot, i === safeIndex && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, overflow: 'hidden' },
  page: { flex: 1, minHeight: 0 },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: '#fff' },
})
