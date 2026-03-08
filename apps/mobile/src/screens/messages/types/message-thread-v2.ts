import { ChatMessage } from '../../../types/models'

export type MessageKind = 'TEXT' | 'MEDIA' | 'VOICE' | 'LOCATION'

export interface ThreadResponse {
  messages: ChatMessage[]
}

export interface ConversationResponse {
  conversation: {
    id: string
    type: 'TEAM' | 'DM' | 'JOB_THREAD'
    title?: string | null
  }
}

export interface ConversationsResponse {
  conversations: Array<{
    id: string
    type?: 'TEAM' | 'DM' | 'JOB_THREAD'
    title?: string | null
    otherUser?: {
      id: string
      firstName?: string | null
      lastName?: string | null
      email: string
      avatar?: string | null
    } | null
  }>
}

export interface AttachmentDraft {
  kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'LOCATION'
  url?: string
  fileName?: string
  mimeType?: string
  sizeBytes?: number
  durationMs?: number
  latitude?: number
  longitude?: number
  localUri?: string
  uploadProgress?: number
}

export interface OptimisticMessage {
  id: string
  clientTempId: string
  senderId: string
  text?: string | null
  type: MessageKind
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  createdAt: string
  attachments?: Array<{
    kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'LOCATION'
    url: string
    fileName?: string | null
    mimeType?: string | null
    sizeBytes?: number | null
    durationMs?: number | null
    latitude?: number | null
    longitude?: number | null
  }>
  replyToMessageId?: string | null
  replyTo?: {
    messageId: string
    senderName: string
    textPreview: string
    type?: 'TEXT' | 'MEDIA' | 'VOICE' | 'LOCATION' | 'SYSTEM'
    createdAt?: string | null
  } | null
  jobId?: string | null
  jobNumber?: string | null
  jobName?: string | null
  isOptimistic: true
}

export interface SendMutationInput {
  clientTempId: string
  outgoingText: string
  outgoingDrafts: AttachmentDraft[]
  outgoingReplyTo: ChatMessage | null
}

export type RenderThreadItem = ChatMessage | OptimisticMessage | { type: 'DATE'; date: Date }
