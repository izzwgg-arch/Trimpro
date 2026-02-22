import React from 'react'
import { SafeAreaView, StyleProp, StyleSheet, ViewStyle } from 'react-native'
import { colors, spacing } from '../theme/tokens'

export function AppScreen({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  padded?: boolean
}) {
  return <SafeAreaView style={[styles.container, padded && styles.padded, style]}>{children}</SafeAreaView>
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  padded: {
    paddingHorizontal: spacing.md,
  },
})

