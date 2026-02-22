import 'react-native-gesture-handler'
import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import * as Linking from 'expo-linking'
import * as SplashScreen from 'expo-splash-screen'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { RootNavigator } from './navigation/RootNavigator'
import { registerPushToken } from './notifications/registerPush'
import { flushOutbox, loadOutbox } from './offline/outbox'
import { useOnlineState } from './hooks/useOnlineState'
import { apiRequest } from './api/client'
import { NotificationPopup } from './components/NotificationPopup'

// Keep splash screen visible until we explicitly hide it
SplashScreen.preventAutoHideAsync()

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

const queryClient = new QueryClient()

function SyncAndPushBootstrap() {
  const { token } = useAuth()
  const isOnline = useOnlineState()
  const [initializedPush, setInitializedPush] = useState(false)
  const assignmentSignatureRef = useRef('')
  const [currentNotification, setCurrentNotification] = useState<Notifications.Notification | null>(null)
  const lastNotificationIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!token || initializedPush) return
    setInitializedPush(true)
    void registerPushToken()
  }, [initializedPush, token])

  // Handle foreground notifications (show popup)
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      // Show popup for foreground notifications
      setCurrentNotification(notification)
    })
    return () => sub.remove()
  }, [])

  // Handle notification taps
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as Record<string, any>
      const directUrl = typeof data.url === 'string' ? data.url : null
      if (directUrl) {
        void Linking.openURL(directUrl)
        return
      }

      const linkType = typeof data.linkType === 'string' ? data.linkType : ''
      const linkId = typeof data.linkId === 'string' ? data.linkId : ''
      if (linkType === 'job' && linkId) void Linking.openURL(`trimprofield://jobs/${linkId}`)
      if (linkType === 'task' && linkId) void Linking.openURL(`trimprofield://tasks/${linkId}`)
      if (linkType === 'issue' && linkId) void Linking.openURL(`trimprofield://issues/${linkId}`)
      if (linkType === 'message' && linkId) void Linking.openURL(`trimprofield://messages/${linkId}`)
    })
    return () => sub.remove()
  }, [])

  // Poll for new notifications
  useEffect(() => {
    if (!token || !isOnline) return
    let stopped = false

    const pollNotifications = async () => {
      try {
        const data = await apiRequest<{
          notifications: Array<{
            id: string
            title: string
            message: string | null
            linkType: string | null
            linkId: string | null
            createdAt: string
          }>
        }>('/api/notifications?status=UNREAD&limit=1')

        // Show the most recent unread notification if it's new
        if (data.notifications.length > 0) {
          const latest = data.notifications[0]
          if (latest.id !== lastNotificationIdRef.current) {
            lastNotificationIdRef.current = latest.id

            // Create a notification object for the popup
            const notification: Notifications.Notification = {
              request: {
                identifier: latest.id,
                content: {
                  title: latest.title,
                  body: latest.message || undefined,
                  data: {
                    linkType: latest.linkType || undefined,
                    linkId: latest.linkId || undefined,
                  },
                },
                trigger: null,
              },
              date: new Date(latest.createdAt),
            }

            setCurrentNotification(notification)
          }
        }
      } catch (error) {
        console.warn('Notification polling error:', error)
        // Non-blocking
      }
    }

    // Poll immediately, then every 3 seconds for faster updates
    void pollNotifications()
    const interval = setInterval(() => {
      if (!stopped) void pollNotifications()
    }, 3000) // Poll every 3 seconds for faster updates

    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [token, isOnline])

  useEffect(() => {
    if (!token || !isOnline) return
    let cancelled = false
    ;(async () => {
      const queue = await loadOutbox()
      if (queue.length === 0 || cancelled) return
      await flushOutbox(token)
      queryClient.invalidateQueries()
    })()
    return () => {
      cancelled = true
    }
  }, [isOnline, token])

  useEffect(() => {
    if (!token || !isOnline) return
    let stopped = false

    const pollAssignments = async () => {
      try {
        const payload = await apiRequest<{
          jobs: Array<{ id: string; updatedAt: string }>
          tasks: Array<{ id: string; updatedAt: string }>
          issues: Array<{ id: string; updatedAt: string }>
        }>('/api/mobile/assignments')

        const nextSignature = JSON.stringify({
          jobs: payload.jobs.map((x) => `${x.id}:${x.updatedAt}`),
          tasks: payload.tasks.map((x) => `${x.id}:${x.updatedAt}`),
          issues: payload.issues.map((x) => `${x.id}:${x.updatedAt}`),
        })

        if (!stopped && assignmentSignatureRef.current && assignmentSignatureRef.current !== nextSignature) {
          queryClient.invalidateQueries({ queryKey: ['mobile-jobs'] })
          queryClient.invalidateQueries({ queryKey: ['mobile-tasks'] })
          queryClient.invalidateQueries({ queryKey: ['mobile-issues'] })
          queryClient.invalidateQueries({ queryKey: ['mobile-schedule'] })
          queryClient.invalidateQueries({ queryKey: ['mobile-conversations'] })
        }

        if (!stopped) assignmentSignatureRef.current = nextSignature
      } catch {
        // Non-blocking; polling retries next interval.
      }
    }

    void pollAssignments()
    const interval = setInterval(() => {
      void pollAssignments()
    }, 60000)

    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [isOnline, token])

  return (
    <>
      <RootNavigator />
      <NotificationPopup
        notification={currentNotification}
        onDismiss={() => setCurrentNotification(null)}
      />
    </>
  )
}

export default function AppRoot() {
  const [appIsReady, setAppIsReady] = useState(false)

  useEffect(() => {
    async function prepare() {
      try {
        // Wait for app to be ready, then add a minimum delay for splash screen
        await new Promise((resolve) => setTimeout(resolve, 2500)) // 2.5 second minimum display
        setAppIsReady(true)
      } catch (e) {
        console.warn('Error preparing app:', e)
        setAppIsReady(true)
      }
    }

    void prepare()
  }, [])

  useEffect(() => {
    if (appIsReady) {
      // Hide splash screen after minimum delay
      void SplashScreen.hideAsync()
    }
  }, [appIsReady])

  if (!appIsReady) {
    return null
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SyncAndPushBootstrap />
      </AuthProvider>
    </QueryClientProvider>
  )
}

