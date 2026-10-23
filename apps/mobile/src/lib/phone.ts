import { Alert, Linking } from 'react-native'

/** Open the phone app with this number ready to call. */
export function callPhone(phone: string | null | undefined) {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '')
  if (!digits) return
  Linking.openURL(`tel:${digits}`).catch(() => Alert.alert('Cannot place call', 'This device cannot make phone calls.'))
}
