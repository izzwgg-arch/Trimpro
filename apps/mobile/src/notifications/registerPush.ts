import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import { apiRequest } from '../api/client'

export async function registerPushToken() {
  if (!Device.isDevice) return null

  const existing = await Notifications.getPermissionsAsync()
  let status = existing.status
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync()
    status = requested.status
  }
  if (status !== 'granted') return null

  const tokenData = await Notifications.getExpoPushTokenAsync()
  const token = tokenData.data

  await apiRequest('/api/mobile/push-token', 'POST', {
    token,
    platform: Platform.OS,
  }).catch(() => {
    // Non-blocking: polling fallback stays active.
  })

  return token
}

