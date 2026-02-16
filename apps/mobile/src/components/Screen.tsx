import React from 'react'
import { SafeAreaView, StyleSheet, ViewProps } from 'react-native'
import { BRAND } from '../config/env'

export function Screen({ style, children }: ViewProps) {
  return <SafeAreaView style={[styles.container, style]}>{children}</SafeAreaView>
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND.bg,
  },
})

