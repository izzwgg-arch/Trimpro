import React, { useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import * as Notifications from 'expo-notifications'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '../../components/Screen'
import { BRAND } from '../../config/env'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../api/client'
import { getLastPushReceivedAt, getStoredPushToken, registerPushToken } from '../../notifications/registerPush'

export function ProfileScreen() {
  const { user, signOut } = useAuth()
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isRegisteringPush, setIsRegisteringPush] = useState(false)

  const appVersion = useMemo(() => {
    return Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'unknown'
  }, [])

  const updateCreatedAt = useMemo(() => {
    return Updates.createdAt ? new Date(Updates.createdAt).toLocaleString() : 'n/a'
  }, [])

  const channel = Updates.channel ?? 'n/a'
  const runtimeVersion = Updates.runtimeVersion ?? 'n/a'
  const updateId = Updates.updateId ?? 'embedded'

  const pushStatusQuery = useQuery({
    queryKey: ['mobile-push-status'],
    queryFn: async () => {
      const permission = await Notifications.getPermissionsAsync()
      const localToken = await getStoredPushToken()
      const lastPushReceivedAt = await getLastPushReceivedAt()
      const remote = await apiRequest<{ devices: Array<{ expoPushToken: string; disabledAt: string | null }> }>(
        '/api/mobile/push/status'
      ).catch(() => ({ devices: [] }))
      return {
        permissionStatus: permission.status,
        localToken,
        lastPushReceivedAt,
        remoteDevices: remote.devices,
      }
    },
    refetchInterval: 20000,
  })

  const onReregisterPush = async () => {
    setIsRegisteringPush(true)
    try {
      await registerPushToken()
      await pushStatusQuery.refetch()
      Alert.alert('Push re-registered', 'Your device token was refreshed.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not register push token.'
      Alert.alert('Push registration failed', message)
    } finally {
      setIsRegisteringPush(false)
    }
  }

  const onSendTestPush = async () => {
    try {
      await apiRequest('/api/mobile/push/test', 'POST', {})
      Alert.alert('Test sent', 'A test push notification was queued for this account.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send test push.'
      Alert.alert('Test failed', message)
    }
  }

  const maskedPushToken = useMemo(() => {
    const token = pushStatusQuery.data?.localToken || ''
    if (!token) return 'Not registered'
    return token.length > 16 ? `${token.slice(0, 10)}...${token.slice(-4)}` : token
  }, [pushStatusQuery.data?.localToken])

  const onCheckForUpdate = async () => {
    if (__DEV__) {
      Alert.alert('Not available in development', 'Use a preview/production build to test OTA updates.')
      return
    }

    setIsCheckingUpdate(true)
    try {
      const result = await Updates.checkForUpdateAsync()
      if (!result.isAvailable) {
        Alert.alert('Up to date', 'No new OTA update is available right now.')
        return
      }

      await Updates.fetchUpdateAsync()
      Alert.alert('Update ready', 'A new update was downloaded. Reload now?', [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Reload',
          onPress: () => {
            Updates.reloadAsync().catch(() => null)
          },
        },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not check for updates.'
      Alert.alert('Update check failed', message)
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  return (
    <Screen style={styles.screen}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.card}>
        <Text style={styles.row}>Name: {user?.firstName} {user?.lastName}</Text>
        <Text style={styles.row}>Email: {user?.email}</Text>
        <Text style={styles.row}>Role: {user?.role}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.subtitle}>Build & Updates</Text>
        <Text style={styles.row}>App Version: {appVersion}</Text>
        <Text style={styles.row}>Channel: {channel}</Text>
        <Text style={styles.row}>Runtime Version: {runtimeVersion}</Text>
        <Text style={styles.row}>Update ID: {updateId}</Text>
        <Text style={styles.row}>Created At: {updateCreatedAt}</Text>
        <Text style={styles.row}>Embedded Launch: {Updates.isEmbeddedLaunch ? 'Yes' : 'No'}</Text>
        <Pressable
          style={[styles.secondaryButton, isCheckingUpdate ? styles.secondaryButtonDisabled : null]}
          onPress={() => onCheckForUpdate()}
          disabled={isCheckingUpdate}
        >
          <Text style={styles.secondaryButtonText}>
            {isCheckingUpdate ? 'Checking...' : 'Check for update'}
          </Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.subtitle}>Notifications</Text>
        <Text style={styles.row}>Permission: {pushStatusQuery.data?.permissionStatus || 'unknown'}</Text>
        <Text style={styles.row}>Local token: {maskedPushToken}</Text>
        <Text style={styles.row}>
          Last push received: {pushStatusQuery.data?.lastPushReceivedAt ? new Date(pushStatusQuery.data.lastPushReceivedAt).toLocaleString() : 'n/a'}
        </Text>
        <Text style={styles.row}>Registered devices: {pushStatusQuery.data?.remoteDevices?.length || 0}</Text>
        <Pressable
          style={[styles.secondaryButton, isRegisteringPush ? styles.secondaryButtonDisabled : null]}
          onPress={() => onReregisterPush()}
          disabled={isRegisteringPush}
        >
          <Text style={styles.secondaryButtonText}>
            {isRegisteringPush ? 'Registering...' : 'Re-register push token'}
          </Text>
        </Pressable>
        {String(user?.role || '') === 'ADMIN' ? (
          <Pressable style={[styles.secondaryButton, { marginTop: 8 }]} onPress={() => onSendTestPush()}>
            <Text style={styles.secondaryButtonText}>Send test push</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable style={styles.button} onPress={() => signOut()}>
        <Text style={styles.buttonText}>Logout</Text>
      </Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14, gap: 12 },
  title: { fontSize: 24, fontWeight: '800', color: BRAND.text },
  subtitle: { fontSize: 16, fontWeight: '700', color: BRAND.text, marginBottom: 6 },
  card: { backgroundColor: BRAND.white, borderRadius: 12, padding: 12, gap: 6 },
  row: { color: BRAND.text, fontSize: 14 },
  button: { backgroundColor: '#B42318', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  buttonText: { color: BRAND.white, fontWeight: '700' },
  secondaryButton: {
    marginTop: 8,
    backgroundColor: BRAND.primary,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 10,
  },
  secondaryButtonDisabled: { opacity: 0.6 },
  secondaryButtonText: { color: BRAND.white, fontWeight: '700' },
})

