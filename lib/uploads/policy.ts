export const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024
export const MAX_VIDEO_FILE_BYTES = 200 * 1024 * 1024
export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
])

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
])

export const ALLOWED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/webm',
])

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/webm': 'webm',
}

export function normalizeMimeType(mimeType: string): string {
  return String(mimeType || '').trim().toLowerCase()
}

export function isAllowedUploadMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType)
  return (
    ALLOWED_DOCUMENT_MIME_TYPES.has(normalized) ||
    ALLOWED_IMAGE_MIME_TYPES.has(normalized) ||
    ALLOWED_VIDEO_MIME_TYPES.has(normalized)
  )
}

export function getMaxBytesForMimeType(mimeType: string): number {
  const normalized = normalizeMimeType(mimeType)
  if (ALLOWED_IMAGE_MIME_TYPES.has(normalized)) return MAX_IMAGE_FILE_BYTES
  if (ALLOWED_VIDEO_MIME_TYPES.has(normalized)) return MAX_VIDEO_FILE_BYTES
  return MAX_DOCUMENT_FILE_BYTES
}

export function safeExtFromMimeType(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType)
  return MIME_TO_EXT[normalized] || 'bin'
}
