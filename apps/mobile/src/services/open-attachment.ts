import { Alert, Linking, Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Sharing from 'expo-sharing'
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

export function getAttachmentKind(
  mimeType?: string | null,
  fileName?: string | null
): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
  const mime = String(mimeType || '').toLowerCase()
  const name = String(fileName || '').toLowerCase()
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(name)) return 'image'
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|3gp)$/i.test(name)) return 'video'
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return 'audio'
  if (isPdfAttachment(mimeType, fileName)) return 'pdf'
  return 'other'
}

function sanitizeFileName(fileName: string): string {
  const cleaned = String(fileName || 'attachment')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim()
  return cleaned || `attachment-${Date.now()}`
}

function inferMimeType(mimeType?: string | null, fileName?: string | null): string {
  const mime = String(mimeType || '').trim().toLowerCase()
  if (mime && mime !== 'application/octet-stream') return mime
  const name = String(fileName || '').toLowerCase()
  const ext = name.includes('.') ? name.split('.').pop() || '' : ''
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
  }
  return byExt[ext] || 'application/octet-stream'
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
 * Open an attachment with a system viewer (PDF/Office/images/etc).
 * Downloads first, then uses Android VIEW intent or the share sheet.
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
  const mimeType = inferMimeType(options.mimeType, fileName)

  try {
    const localUri = await downloadToCache(url, fileName)

    if (Platform.OS === 'android') {
      try {
        const contentUri = await FileSystem.getContentUriAsync(localUri)
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1,
          type: mimeType,
        })
        return
      } catch {
        // Fall through to share sheet / remote URL.
      }
    }

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(localUri, {
        mimeType,
        dialogTitle: fileName,
        UTI: mimeType,
      })
      return
    }

    const canOpen = await Linking.canOpenURL(url)
    if (canOpen) {
      await Linking.openURL(url)
      return
    }

    Alert.alert(
      'Unable to open file',
      'No app on this phone can open this document. Try installing a PDF or Office viewer.'
    )
  } catch (error: any) {
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert(
        'Unable to open file',
        error?.message || 'No app on this phone can open this document. Try installing a PDF or Office viewer.'
      )
    }
  }
}

/** Save a data URL (e.g. marked PNG) and open the system share sheet. */
export async function shareDataUrl(options: {
  dataUrl: string
  fileName?: string | null
}): Promise<void> {
  const match = String(options.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    Alert.alert('Unable to save', 'Marked image data was invalid.')
    return
  }
  const mimeType = match[1] || 'image/png'
  const base64 = match[2]
  const ext = mimeType.includes('jpeg') ? 'jpg' : 'png'
  const fileName = sanitizeFileName(
    (options.fileName || 'attachment').replace(/\.[^.]+$/, '') + `-marked.${ext}`
  )
  const target = `${FileSystem.cacheDirectory}${Date.now()}-${fileName}`
  await FileSystem.writeAsStringAsync(target, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target, { mimeType, dialogTitle: fileName, UTI: mimeType })
    return
  }

  Alert.alert('Saved', `Marked image written to cache as ${fileName}`)
}
