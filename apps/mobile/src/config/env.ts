const explicitApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim()
const fallbackApiUrl = __DEV__ ? 'http://10.0.2.2:3000' : 'https://app.trimprony.com'

export const API_BASE_URL = (explicitApiUrl || fallbackApiUrl).replace(/\/+$/, '')

export const BRAND = {
  primary: '#2E4A59',
  accent: '#E6C98B',
  bg: '#F6F7F9',
  white: '#FFFFFF',
  text: '#101828',
  muted: '#667085',
}

