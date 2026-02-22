import React, { useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Screen } from '../../components/Screen'
import { useAuth } from '../../auth/AuthContext'
import { colors, spacing, radius, shadows } from '../../theme/tokens'

function TrimProLogo() {
  return (
    <View style={styles.logoContainer}>
      <View style={styles.logoBox}>
        <Text style={styles.logoText}>TrimPro</Text>
        <View style={styles.logoIcon}>
          <View style={styles.iconRect1} />
          <View style={styles.iconRect2} />
          <View style={styles.iconRect3} />
          <View style={styles.iconCircle1} />
          <View style={styles.iconCircle2} />
        </View>
      </View>
    </View>
  )
}

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
    <Screen style={styles.root} padded={false}>
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.header}>
            <TrimProLogo />
            <Text style={styles.subtitle}>Sign in to your account</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email"
                placeholderTextColor="#9CA3AF"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                secureTextEntry
                placeholder="Password"
                placeholderTextColor="#9CA3AF"
                style={styles.input}
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <Pressable
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={onSubmit}
              disabled={loading}
            >
              <Text style={styles.buttonText}>{loading ? 'Signing in...' : 'Sign in'}</Text>
            </Pressable>

            <Pressable style={styles.forgotLink}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              By signing in, you agree to our{' '}
              <Text style={styles.footerLink} onPress={() => Linking.openURL('https://app.trimprony.com/terms')}>
                Terms
              </Text>{' '}
              and{' '}
              <Text style={styles.footerLink} onPress={() => Linking.openURL('https://app.trimprony.com/privacy')}>
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#F9FAFB',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    ...shadows.card,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logoBox: {
    backgroundColor: '#2E4A59',
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoText: {
    fontFamily: 'System',
    fontWeight: '700',
    fontSize: 30,
    letterSpacing: -0.02,
    color: '#E6C98B',
  },
  logoIcon: {
    width: 30,
    height: 30,
    position: 'relative',
  },
  iconRect1: {
    position: 'absolute',
    top: 3,
    left: 5,
    width: 22,
    height: 5,
    backgroundColor: '#E6C98B',
    borderRadius: 0.75,
  },
  iconRect2: {
    position: 'absolute',
    top: 14,
    left: 11,
    width: 3,
    height: 15,
    backgroundColor: '#E6C98B',
    borderRadius: 0.5,
  },
  iconRect3: {
    position: 'absolute',
    top: 14,
    left: 18,
    width: 3,
    height: 15,
    backgroundColor: '#E6C98B',
    borderRadius: 0.5,
  },
  iconCircle1: {
    position: 'absolute',
    top: 12.5,
    left: 11,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#E6C98B',
  },
  iconCircle2: {
    position: 'absolute',
    top: 12.5,
    left: 19.5,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#E6C98B',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  form: {
    gap: spacing.lg,
  },
  inputGroup: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  button: {
    marginTop: spacing.sm,
    backgroundColor: '#2E4A59',
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#E6C98B',
    fontWeight: '700',
    fontSize: 16,
  },
  forgotLink: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  forgotText: {
    fontSize: 14,
    color: '#2E4A59',
    textDecorationLine: 'underline',
  },
  footer: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  footerLink: {
    color: '#2E4A59',
    textDecorationLine: 'underline',
  },
})

