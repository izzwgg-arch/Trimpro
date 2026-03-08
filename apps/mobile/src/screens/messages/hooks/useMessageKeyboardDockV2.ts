import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Keyboard, Platform } from 'react-native'
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs'

export function useMessageKeyboardDockV2() {
  const tabBarHeight = useBottomTabBarHeight()
  const [closedTabBarHeight, setClosedTabBarHeight] = useState(tabBarHeight)
  const [dockHeight, setDockHeight] = useState(0)
  const dockBottom = useRef(new Animated.Value(tabBarHeight)).current
  const keyboardHeightRef = useRef(0)

  useEffect(() => {
    if (tabBarHeight > 0) {
      setClosedTabBarHeight(tabBarHeight)
    }
  }, [tabBarHeight])

  useEffect(() => {
    if (keyboardHeightRef.current > 0) return
    dockBottom.setValue(closedTabBarHeight)
  }, [closedTabBarHeight, dockBottom])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const animateDock = (toValue: number, duration?: number) => {
      Animated.timing(dockBottom, {
        toValue,
        duration: duration ?? 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start()
    }

    const showSub = Keyboard.addListener(showEvent, (event) => {
      const keyboardHeight = event.endCoordinates?.height || 0
      keyboardHeightRef.current = keyboardHeight
      animateDock(keyboardHeight, event.duration)
    })

    const hideSub = Keyboard.addListener(hideEvent, (event) => {
      keyboardHeightRef.current = 0
      animateDock(closedTabBarHeight, event?.duration)
    })

    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [closedTabBarHeight, dockBottom])

  const onDockLayout = useCallback((height: number) => {
    setDockHeight((prev) => (prev === height ? prev : height))
  }, [])

  return {
    dockBottom,
    onDockLayout,
    listReserveTop: dockHeight + closedTabBarHeight,
    closedTabBarHeight,
  }
}
