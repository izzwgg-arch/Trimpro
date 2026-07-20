import { Alert, Linking, Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import * as WebBrowser from 'expo-web-browser'
import { API_BASE_URL } from '../config/env'

const MEDIA_BASE_URL = API_BASE_URL || 'https://app.trimprony.com'

export function normalizeAttachmentUrl(rawUrl: string): string {
  const value = String(rawUrl || '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value, MEDIA_BASE_URL)
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return `${MEDIA_BASE_URL}${parsed.pathname}${parsed.search}`
    }
    return parsed.toString()
  } catch {
    if (value.startsWith('/')) return `${MEDIA_BASE_URL}${value}`
    return value
  }
}

export function isPdfAttachment(mimeType?: string | null, fileName?: string | null): boolean {
  const mime = String(mimeType || '').toLowerCase()
  const name = String(fileName || '').toLowerCase()
  return mime.includes('pdf') || name.endsWith('.pdf')
}

function sanitizeFileName(fileName: string): string {
  const cleaned = String(fileName || 'attachment')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim()
  return cleaned || `attachment-${Date.now()}`
}

async function downloadToCache(url: string, fileName: string): Promise<string> {
  const target = `${FileSystem.cacheDirectory}${Date.now()}-${sanitizeFileName(fileName)}`
  const result = await FileSystem.downloadAsync(url, target)
  if (result.status && result.status >= 400) {
    throw new Error(`Download failed (${result.status})`)
  }
  return result.uri
}

/**
 * Open an attachment like the web gallery "Open" action.
 * Images/videos are handled by callers; this focuses on PDFs/docs.
 */
export async function openAttachment(options: {
  url: string
  fileName?: string | null
  mimeType?: string | null
}): Promise<void> {
  const url = normalizeAttachmentUrl(options.url)
  if (!url) {
    Alert.alert('Unable to open file', 'This attachment has no download URL.')
    return
  }

  const fileName = sanitizeFileName(options.fileName || url.split('/').pop() || 'attachment')
  const mime = String(options.mimeType || '').toLowerCase()
  const isPdf = isPdfAttachment(options.mimeType, options.fileName)
  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')
  const isAudio = mime.startsWith('audio/')

  try {
    // PDFs: open in in-app browser first (closest to web iframe / Open).
    if (isPdf) {
      try {
        await WebBrowser.openBrowserAsync(url, {
          enableBarCollapsing: true,
          showTitle: true,
        })
        return
      } catch {
        // Fall through to download/share.
      }
    }

    // Direct open for media URLs when possible.
    if (isImage || isVideo || isAudio) {
      await Linking.openURL(url)
      return
    }

    // Docs (PDF fallback, Word, Excel, etc.): download then open/share with a system app.
    const localUri = await downloadToCache(url, fileName)

    if (Platform.OS === 'android') {
      try {
        const contentUri = await FileSystem.getContentUriAsync(localUri)
        await Linking.openURL(contentUri)
        return
      } catch {
        // Fall through to share sheet.
      }
    }

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(localUri, {
        mimeType: options.mimeType || undefined,
        dialogTitle: fileName,
        UTI: isPdf ? 'com.adobe.pdf' : undefined,
      })
      return
    }

    await Linking.openURL(localUri)
  } catch (error: any) {
    // Last resort: try the remote URL directly (Chrome/Files may handle it).
    try {
      await Linking.openURL(url)
      return
    } catch {
      Alert.alert(
        'Unable to open file',
        error?.message || 'No app on this phone can open this document. Try installing a PDF/Office viewer.'
      )
    }
  }
}
