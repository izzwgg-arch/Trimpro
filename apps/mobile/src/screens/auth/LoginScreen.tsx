import React, { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Screen } from '../../components/Screen'
import { BRAND } from '../../config/env'
import { useAuth } from '../../auth/AuthContext'

export function LoginScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async () => {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Enter your email and password.')
      return
    }
    setLoading(true)
    try {
      await signIn(email.trim(), password)
    } catch (error: any) {
      Alert.alert('Login failed', error?.message || 'Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>TrimPro Field</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>
        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          secureTextEntry
          placeholder="Password"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />
        <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={onSubmit} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Signing in...' : 'Sign in'}</Text>
        </Pressable>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: BRAND.white,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: BRAND.primary,
  },
  subtitle: {
    fontSize: 14,
    color: BRAND.muted,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    marginTop: 8,
    backgroundColor: BRAND.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: BRAND.white,
    fontWeight: '700',
    fontSize: 16,
  },
})

