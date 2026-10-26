import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Image, Modal, Pressable, StatusBar, StyleSheet, Text, Vibration, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { Ionicons } from '@expo/vector-icons'
import { Camera } from 'expo-camera'
import { API_BASE_URL } from '../config/env'
import { apiRequest, getValidAccessToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { setVideoCallListener, type CallRequest } from './videoCallBus'

type CallInfo = {
  id: string
  status: 'RINGING' | 'ACTIVE' | 'ENDED' | 'DECLINED' | 'MISSED' | 'CANCELED'
  video: boolean
  role: 'caller' | 'callee'
  otherUser: { id: string; name: string; avatar: string | null }
}

const POLL_MS = 3000

/**
 * Rings for incoming calls and shows the call itself. The call screen is the web call page
 * (same as the dashboard) inside a WebView, so web and app run the same WebRTC code; the
 * sign-in token is handed to the page directly instead of going in the URL.
 */
export function VideoCallHost() {
  const { token } = useAuth()
  const [incoming, setIncoming] = useState<CallInfo | null>(null)
  const [active, setActive] = useState<{ id: string; token: string } | null>(null)
  const handledRef = useRef<Set<string>>(new Set())
  const activeRef = useRef(false)
  const webRef = useRef<WebView | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  activeRef.current = !!active

  const pollIncoming = useCallback(async () => {
    if (activeRef.current || AppState.currentState !== 'active') return
    try {
      const data = await apiRequest<{ calls: CallInfo[] }>('/api/video-calls/incoming')
      const next = data.calls.find((c) => !handledRef.current.has(c.id)) || null
      setIncoming((prev) => (prev?.id === next?.id ? prev : next))
    } catch {
      // offline or no access; try again next tick
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setIncoming(null)
      return
    }
    void pollIncoming()
    const timer = setInterval(() => void pollIncoming(), POLL_MS)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pollIncoming()
    })
    return () => {
      clearInterval(timer)
      sub.remove()
    }
  }, [token, pollIncoming])

  useEffect(() => {
    if (!incoming || active) return
    Vibration.vibrate([0, 900, 900], true)
    return () => Vibration.cancel()
  }, [incoming, active])

  const openCallScreen = useCallback(async (callId: string, video: boolean) => {
    // Ask for the phone permissions first; the WebView only gets camera/mic the app already has.
    const mic = await Camera.requestMicrophonePermissionsAsync().catch(() => null)
    if (video) await Camera.requestCameraPermissionsAsync().catch(() => null)
    if (mic && !mic.granted) {
      Alert.alert('Microphone blocked', 'Allow microphone access for TrimPro Field in your phone settings so the other person can hear you.')
    }
    const accessToken = await getValidAccessToken()
    if (!accessToken) return
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setActive({ id: callId, token: accessToken })
  }, [])

  const answer = useCallback(async () => {
    if (!incoming) return
    const call = incoming
    handledRef.current.add(call.id)
    setIncoming(null)
    try {
      await apiRequest(`/api/video-calls/${call.id}`, 'POST', { action: 'answer' })
      await openCallScreen(call.id, call.video)
    } catch (error: any) {
      Alert.alert('Call ended', error?.message || 'This call has already ended')
    }
  }, [incoming, openCallScreen])

  const decline = useCallback(() => {
    if (!incoming) return
    handledRef.current.add(incoming.id)
    const id = incoming.id
    setIncoming(null)
    void apiRequest(`/api/video-calls/${id}`, 'POST', { action: 'decline' }).catch(() => null)
  }, [incoming])

  const closeCall = useCallback((hangUp: boolean) => {
    setActive((current) => {
      if (current && hangUp) {
        void apiRequest(`/api/video-calls/${current.id}`, 'POST', { action: 'end' }).catch(() => null)
      }
      return null
    })
  }, [])

  useEffect(() => {
    setVideoCallListener(async (request: CallRequest) => {
      if (request.type === 'check') return void pollIncoming()
      if (activeRef.current) {
        Alert.alert('Already on a call', 'End the current call first.')
        return
      }
      try {
        if (request.type === 'start') {
          const data = await apiRequest<{ call: CallInfo }>('/api/video-calls', 'POST', { ...request.target, video: request.video })
          await openCallScreen(data.call.id, data.call.video)
          return
        }
        const data = await apiRequest<{ call: CallInfo }>(`/api/video-calls/${request.callId}`)
        const call = data.call
        if (call.status === 'RINGING' && call.role === 'callee') {
          handledRef.current.delete(call.id)
          setIncoming(call)
        } else if (call.status === 'ACTIVE') {
          await openCallScreen(call.id, call.video)
        } else {
          Alert.alert('Call ended', `The call with ${call.otherUser.name} has ended.`)
        }
      } catch (error: any) {
        Alert.alert('Call', error?.message || 'Could not start the call')
      }
    })
    return () => setVideoCallListener(null)
  }, [openCallScreen, pollIncoming])

  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      let message: any = null
      try {
        message = JSON.parse(event.nativeEvent.data)
      } catch {
        return
      }
      if (message?.type === 'call-ended') {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
        closeTimerRef.current = setTimeout(() => closeCall(false), 1800)
      } else if (message?.type === 'token-expired') {
        const fresh = await getValidAccessToken(true)
        if (fresh) webRef.current?.injectJavaScript(`window.__TRIMPRO_CALL_TOKEN__ = ${JSON.stringify(fresh)}; true;`)
      }
    },
    [closeCall]
  )

  const confirmHangUp = useCallback(() => {
    Alert.alert('End call?', undefined, [
      { text: 'Stay', style: 'cancel' },
      { text: 'End call', style: 'destructive', onPress: () => closeCall(true) },
    ])
  }, [closeCall])

  return (
    <>
      <Modal visible={!!incoming && !active} animationType="slide" transparent={false} statusBarTranslucent onRequestClose={decline}>
        <StatusBar barStyle="light-content" />
        {incoming ? (
          <View style={styles.incoming}>
            <View style={styles.incomingTop}>
              <View style={styles.avatar}>
                {incoming.otherUser.avatar ? (
                  <Image source={{ uri: incoming.otherUser.avatar }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarLetter}>{incoming.otherUser.name.slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <Text style={styles.callerName}>{incoming.otherUser.name}</Text>
              <Text style={styles.callerSub}>{incoming.video ? 'Incoming video call' : 'Incoming call'}</Text>
            </View>
            <View style={styles.incomingButtons}>
              <View style={styles.buttonCol}>
                <Pressable onPress={decline} style={[styles.roundButton, styles.decline]} accessibilityLabel="Decline">
                  <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                </Pressable>
                <Text style={styles.buttonLabel}>Decline</Text>
              </View>
              <View style={styles.buttonCol}>
                <Pressable onPress={() => void answer()} style={[styles.roundButton, styles.accept]} accessibilityLabel="Answer">
                  <Ionicons name={incoming.video ? 'videocam' : 'call'} size={30} color="#fff" />
                </Pressable>
                <Text style={styles.buttonLabel}>Answer</Text>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>

      <Modal visible={!!active} animationType="slide" statusBarTranslucent onRequestClose={confirmHangUp}>
        <StatusBar barStyle="light-content" />
        {active ? (
          <WebView
            ref={webRef}
            key={active.id}
            source={{ uri: `${API_BASE_URL}/call/${active.id}` }}
            injectedJavaScriptBeforeContentLoaded={`window.__TRIMPRO_CALL_TOKEN__ = ${JSON.stringify(active.token)}; true;`}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            mediaCapturePermissionGrantType="grant"
            originWhitelist={['https://*', 'http://*']}
            style={styles.web}
            containerStyle={styles.web}
          />
        ) : null}
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  incoming: {
    flex: 1,
    backgroundColor: '#0b141a',
    justifyContent: 'space-between',
    paddingTop: 120,
    paddingBottom: 80,
  },
  incomingTop: { alignItems: 'center', paddingHorizontal: 24 },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2e4a59',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 20,
  },
  avatarImage: { width: 120, height: 120 },
  avatarLetter: { color: '#fff', fontSize: 48, fontWeight: '600' },
  callerName: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center' },
  callerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 16, marginTop: 8 },
  incomingButtons: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 40 },
  buttonCol: { alignItems: 'center', gap: 10 },
  roundButton: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  decline: { backgroundColor: '#dc2626' },
  accept: { backgroundColor: '#16a34a' },
  buttonLabel: { color: '#fff', fontSize: 14 },
  web: { flex: 1, backgroundColor: '#0b141a' },
})
