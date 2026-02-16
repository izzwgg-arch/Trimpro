import React, { useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { Screen } from '../../components/Screen'
import { BRAND } from '../../config/env'
import { useAuth } from '../../auth/AuthContext'

export function ProfileScreen() {
  const { user, signOut } = useAuth()
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)

  const appVersion = useMemo(() => {
    return Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'unknown'
  }, [])

  const updateCreatedAt = useMemo(() => {
    return Updates.createdAt ? new Date(Updates.createdAt).toLocaleString() : 'n/a'
  }, [])

  const channel = Updates.channel ?? 'n/a'
  const runtimeVersion = Updates.runtimeVersion ?? 'n/a'
  const updateId = Updates.updateId ?? 'embedded'

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

