import { Alert, Linking } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { API_BASE_URL } from '../config/env'
import { getAccessToken } from '../auth/secure-storage'

export type AttachmentPickAction =
  | 'take-photo'
  | 'record-video'
  | 'choose-photos'
  | 'choose-videos'
  | 'choose-document'

export type AttachmentKind = 'image' | 'video' | 'document'

export interface LocalAttachmentFile {
  localId: string
  uri: string
  name: string
  mimeType: string
  sizeBytes: number
  kind: AttachmentKind
}

export interface UploadResponse<T = unknown> {
  raw: T
}

export interface UploadQueueItem<T = unknown> {
  id: string
  file: LocalAttachmentFile
  status: 'pending' | 'uploading' | 'success' | 'failed' | 'cancelled'
  progress: number
  error?: string
  result?: T
}

const MIME_BY_EXTENSION: Record<string, string> = {
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
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
}

function inferMimeType(name: string, fallback: string): string {
  const ext = String(name || '')
    .split('.')
    .pop()
    ?.trim()
    .toLowerCase()
  if (!ext) return fallback
  return MIME_BY_EXTENSION[ext] || fallback
}

function toLocalFile(input: {
  uri: string
  name?: string | null
  mimeType?: string | null
  size?: number | null
  kind: AttachmentKind
}): LocalAttachmentFile {
  const name = input.name?.trim() || `${input.kind}-${Date.now()}`
  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    uri: input.uri,
    name,
    mimeType: inferMimeType(name, (input.mimeType || 'application/octet-stream').toLowerCase()),
    sizeBytes: Number(input.size || 0),
    kind: input.kind,
  }
}

async function ensureCameraPermission(): Promise<boolean> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) {
    Alert.alert(
      'Camera permission required',
      'Enable camera permission in Settings to capture photos and videos.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]
    )
    return false
  }
  return true
}

async function ensureMediaPermission(): Promise<boolean> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    Alert.alert(
      'Media permission required',
      'Enable photo and video library permission in Settings to choose files.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]
    )
    return false
  }
  return true
}

export async function pickAttachmentsByAction(action: AttachmentPickAction): Promise<LocalAttachmentFile[]> {
  if (action === 'take-photo') {
    if (!(await ensureCameraPermission())) return []
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    })
    if (result.canceled) return []
    return result.assets.map((asset) =>
      toLocalFile({
        uri: asset.uri,
        name: asset.fileName,
        mimeType: asset.mimeType,
        size: asset.fileSize,
        kind: 'image',
      })
    )
  }

  if (action === 'record-video') {
    if (!(await ensureCameraPermission())) return []
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      quality: 0.85,
      videoMaxDuration: 300,
    })
    if (result.canceled) return []
    return result.assets.map((asset) =>
      toLocalFile({
        uri: asset.uri,
        name: asset.fileName,
        mimeType: asset.mimeType,
        size: asset.fileSize,
        kind: 'video',
      })
    )
  }

  if (action === 'choose-photos') {
    if (!(await ensureMediaPermission())) return []
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.9,
    })
    if (result.canceled) return []
    return result.assets.map((asset) =>
      toLocalFile({
        uri: asset.uri,
        name: asset.fileName,
        mimeType: asset.mimeType,
        size: asset.fileSize,
        kind: 'image',
      })
    )
  }

  if (action === 'choose-videos') {
    if (!(await ensureMediaPermission())) return []
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      quality: 0.85,
    })
    if (result.canceled) return []
    return result.assets.map((asset) =>
      toLocalFile({
        uri: asset.uri,
        name: asset.fileName,
        mimeType: asset.mimeType,
        size: asset.fileSize,
        kind: 'video',
      })
    )
  }

  const docs = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
    ],
  })
  if (docs.canceled) return []
  return docs.assets.map((asset) =>
    toLocalFile({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
      kind: 'document',
    })
  )
}

export function fileTypeIconName(file: LocalAttachmentFile): string {
  if (file.kind === 'image') return 'image-outline'
  if (file.kind === 'video') return 'videocam-outline'
  return 'document-text-outline'
}

export function formatFileSize(sizeBytes: number): string {
  const size = Number(sizeBytes || 0)
  if (size <= 0) return 'Unknown size'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function uploadFileWithProgress<T>(
  endpointPath: string,
  file: LocalAttachmentFile,
  onProgress?: (progress: number) => void
): { promise: Promise<UploadResponse<T>>; cancel: () => void } {
  let xhr: XMLHttpRequest | null = new XMLHttpRequest()
  const promise = new Promise<UploadResponse<T>>(async (resolve, reject) => {
    try {
      const token = await getAccessToken()
      if (!token) {
        reject(new Error('Not authenticated'))
        return
      }
      if (!xhr) {
        reject(new Error('Upload cancelled'))
        return
      }

      const formData = new FormData()
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType,
      } as any)

      xhr.open('POST', `${API_BASE_URL}${endpointPath}`)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('Accept', 'application/json')
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const progress = Math.max(0, Math.min(1, event.loaded / event.total))
        onProgress?.(progress)
      }
      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.onabort = () => reject(new Error('Upload cancelled'))
      xhr.onload = () => {
        const status = Number(xhr?.status || 0)
        const bodyText = xhr?.responseText || '{}'
        let body: any = {}
        try {
          body = JSON.parse(bodyText)
        } catch {
          body = {}
        }
        if (status < 200 || status >= 300) {
          reject(new Error(body?.error || `Upload failed (${status})`))
          return
        }
        onProgress?.(1)
        resolve({ raw: body as T })
      }

      xhr.send(formData)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Upload failed'))
    }
  })

  return {
    promise,
    cancel: () => {
      if (xhr) xhr.abort()
      xhr = null
    },
  }
}
