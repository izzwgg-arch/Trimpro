import 'react-native-gesture-handler'
import React, { useEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import * as Linking from 'expo-linking'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { RootNavigator } from './navigation/RootNavigator'
import { registerPushToken } from './notifications/registerPush'
import { flushOutbox, loadOutbox } from './offline/outbox'
import { useOnlineState } from './hooks/useOnlineState'
import { apiRequest } from './api/client'

const queryClient = new QueryClient()

function SyncAndPushBootstrap() {
  const { token } = useAuth()
  const isOnline = useOnlineState()
  const [initializedPush, setInitializedPush] = useState(false)
  const assignmentSignatureRef = useRef('')

  useEffect(() => {
    if (!token || initializedPush) return
    setInitializedPush(true)
    void registerPushToken()
  }, [initializedPush, token])

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

  return <RootNavigator />
}

export default function AppRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SyncAndPushBootstrap />
      </AuthProvider>
    </QueryClientProvider>
  )
}

