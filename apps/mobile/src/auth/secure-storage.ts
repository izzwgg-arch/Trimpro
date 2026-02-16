import * as SecureStore from 'expo-secure-store'

const ACCESS_TOKEN_KEY = 'trimpro.mobile.accessToken'
const REFRESH_TOKEN_KEY = 'trimpro.mobile.refreshToken'
const USER_KEY = 'trimpro.mobile.user'

export async function saveAuth(accessToken: string, refreshToken: string, userJson: string) {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
    SecureStore.setItemAsync(USER_KEY, userJson),
  ])
}

export async function getAccessToken() {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY)
}

export async function getRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
}

export async function getStoredUser() {
  return SecureStore.getItemAsync(USER_KEY)
}

export async function clearAuth() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ])
}

