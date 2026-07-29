import React from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Job } from '../types/models'
import { colors, spacing, typography } from '../theme/tokens'
import { PressableCard } from './Card'
import { StatusBadge } from './StatusBadge'
import { BillingStatusBadge } from './BillingStatusBadge'

export function JobCard({
  job,
  onPress,
  hasUnreadMessages,
  hasNewMedia,
  hasOpenIssue,
}: {
  job: Job
  onPress: () => void
  hasUnreadMessages?: boolean
  hasNewMedia?: boolean
  hasOpenIssue?: boolean
}) {
  const scheduleText = job.createdAt
    ? `Created ${new Date(job.createdAt).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`
    : job.scheduledStart
      ? new Date(job.scheduledStart).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'No date'

  const address = job.address?.street
    ? `${job.address.street}, ${job.address.city || ''} ${job.address.state || ''}`.trim()
    : 'No job site address'

  return (
    <PressableCard onPress={onPress}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Text style={styles.jobTitle} numberOfLines={1}>
            {job.jobNumber} - {job.title}
          </Text>
          <Text style={styles.client} numberOfLines={1}>
            {job.client?.name || 'No client'}
          </Text>
        </View>
        <View style={styles.badgeCol}>
          <StatusBadge status={job.status} />
          <BillingStatusBadge status={job.billingStatus} />
        </View>
      </View>

      <Text style={styles.meta} numberOfLines={1}>
        {scheduleText}
      </Text>
      {job.address?.street ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation()
            const fullAddress = `${job.address.street}, ${job.address.city || ''} ${job.address.state || ''} ${job.address.zipCode || ''}`.trim()
            const encodedAddress = encodeURIComponent(fullAddress)
            
            // Try Google Maps app first
            const androidGoogleMapsUrl = `comgooglemaps://?q=${encodedAddress}`
            const iosGoogleMapsUrl = `googlemaps://?q=${encodedAddress}`
            // Fallback to native maps
            const appleMapsUrl = `maps://?q=${encodedAddress}`
            // Final fallback to web Google Maps
            const webMapsUrl = `https://maps.google.com/?q=${encodedAddress}`
            
            const googleMapsUrl = Platform.OS === 'android' ? androidGoogleMapsUrl : iosGoogleMapsUrl
            
            // Try Google Maps app first
            Linking.canOpenURL(googleMapsUrl)
              .then((supported) => {
                if (supported) {
                  return Linking.openURL(googleMapsUrl)
                }
                // Fallback to native maps (iOS Maps or Android Maps)
                return Linking.canOpenURL(appleMapsUrl).then((nativeSupported) => {
                  if (nativeSupported) {
                    return Linking.openURL(appleMapsUrl)
                  }
                  // Final fallback to web
                  return Linking.openURL(webMapsUrl)
                })
              })
              .catch(() => Linking.openURL(webMapsUrl))
          }}
        >
          <Text style={[styles.meta, styles.addressLink]} numberOfLines={1}>
            {address}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.meta} numberOfLines={1}>
          {address}
        </Text>
      )}

      <View style={styles.iconRow}>
        <IconDot name="chatbubble-ellipses-outline" active={Boolean(hasUnreadMessages)} />
        <IconDot name="images-outline" active={Boolean(hasNewMedia)} />
        <IconDot name="alert-circle-outline" active={Boolean(hasOpenIssue)} danger />
      </View>
    </PressableCard>
  )
}

function IconDot({
  name,
  active,
  danger,
}: {
  name: keyof typeof Ionicons.glyphMap
  active: boolean
  danger?: boolean
}) {
  const color = active ? (danger ? '#B42318' : colors.brandPrimary) : colors.muted
  return (
    <Pressable disabled style={styles.iconPill}>
      <Ionicons name={name} size={14} color={color} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  badgeCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  jobTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  client: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  iconRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconPill: {
    minHeight: 24,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressLink: {
    color: colors.brandPrimary,
    textDecorationLine: 'underline',
  },
})

