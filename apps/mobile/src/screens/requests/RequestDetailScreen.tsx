import { callPhone } from '../../lib/phone'
import React from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { InfiniteData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { EmptyState } from '../../components/EmptyState'
import { DetailRow, DetailSection } from '../../components/DetailSection'
import { apiRequest } from '../../api/client'
import { JobsStackParamList } from '../../types/navigation'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { getRequestDetailsErrorCopy } from './request-utils'
import { AttachmentPickerSheet } from '../../components/attachments/AttachmentPickerSheet'
import { AttachmentUploadQueue } from '../../components/attachments/AttachmentUploadQueue'
import { pickAttachmentsByAction, uploadFileWithProgress } from '../../services/attachment-upload'
import { isPdfAttachment, normalizeAttachmentUrl } from '../../services/open-attachment'
import { AttachmentGalleryModal } from '../../components/attachments/AttachmentGalleryModal'
import { AttachmentOpenPressable } from '../../components/attachments/AttachmentOpenPressable'
import { useAttachmentUploadQueue } from '../../hooks/useAttachmentUploadQueue'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'

type Props = NativeStackScreenProps<JobsStackParamList, 'RequestDetail'>

interface RequestPerson {
  id?: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
}

interface RequestDetailLead {
  id: string
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  company?: string | null
  source: string
  status: string
  jobType?: string | null
  isUrgent?: boolean
  urgentAt?: string | null
  urgentByUserId?: string | null
  value?: string | number | null
  probability?: number | null
  notes?: string | null
  jobSiteAddress?: string | null
  jobSiteCity?: string | null
  jobSiteState?: string | null
  jobSiteZipCode?: string | null
  convertedToClientId?: string | null
  convertedAt?: string | null
  createdAt: string
  assignedTo?: RequestPerson | null
  client?: {
    id: string
    name: string
    companyName?: string | null
  } | null
  estimates?: Array<{
    id: string
    estimateNumber: string
    title: string
    total: string | number
    status: string
    createdAt: string
  }>
  tasks?: Array<{
    id: string
    title: string
    status: string
    priority?: string
    dueDate?: string | null
  }>
  issues?: Array<{
    id: string
    title: string
    status: string
    priority?: string
  }>
  calls?: Array<{
    id: string
    direction: string
    status: string
    fromNumber: string
    toNumber: string
    duration?: number | null
    startedAt: string
  }>
  smsMessages?: Array<{
    id: string
    direction: string
    status: string
    body?: string | null
    sentAt?: string | null
  }>
  emails?: Array<{
    id: string
    direction: string
    status: string
    subject: string
    sentAt?: string | null
  }>
  schedules?: Array<{
    id: string
    startTime: string
    endTime: string
    user?: {
      firstName?: string | null
      lastName?: string | null
    } | null
  }>
  activities?: Array<{
    id: string
    type: string
    description: string
    createdAt: string
    user?: {
      firstName?: string | null
      lastName?: string | null
    } | null
  }>
  _count?: {
    estimates?: number
    tasks?: number
    issues?: number
    calls?: number
    smsMessages?: number
    emails?: number
  }
}

interface RequestDetailResponse {
  lead: RequestDetailLead
}

interface AttachmentResponse {
  attachments: Array<{
    id: string
    fileName: string
    url: string
    mimeType: string
    fileSize: number
    createdAt: string
    thumbnailUrl?: string | null
    previewUrl?: string | null
  }>
}

interface TeamMember {
  id: string
  firstName: string
  lastName: string
  email?: string | null
  role?: string
}

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  ESTIMATE_CREATED: 'Estimate Created',
  ESTIMATE_SENT: 'Estimate Sent',
  FOLLOW_UP: 'Follow Up',
  CONVERTED: 'Converted',
  LOST: 'Lost',
}

// Matches the Requests production board colors (lib/production/boards.ts).
const LEAD_STATUS_HEX: Record<string, string> = {
  NEW: '#3b82f6', CONTACTED: '#0ea5e9', QUALIFIED: '#6366f1', ESTIMATE_CREATED: '#8b5cf6',
  ESTIMATE_SENT: '#a855f7', FOLLOW_UP: '#d97706', CONVERTED: '#16a34a', LOST: '#ef4444',
}
// 15%-opacity tint of a hex color for badge backgrounds.
function tint(hex: string) {
  return hex.length === 7 ? `${hex}26` : hex
}

function formatLabel(value?: string | null) {
  if (!value) return ''
  return STATUS_LABELS[value] || value.replace(/_/g, ' ')
}

function formatCurrency(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null
  const amount = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(amount)) return String(value)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return 'N/A'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function personName(person?: RequestPerson | null) {
  if (!person) return 'Unassigned'
  return `${person.firstName || ''} ${person.lastName || ''}`.trim() || 'Unassigned'
}

function CollapsibleCard({ icon, title, countBadge, rightText, open, onToggle, collapsedChildren, children }: {
  icon?: keyof typeof Ionicons.glyphMap
  title: string
  countBadge?: number
  rightText?: string
  open: boolean
  onToggle: () => void
  collapsedChildren?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHeader} onPress={onToggle}>
        <View style={styles.cardHeaderLeft}>
          {icon ? <Ionicons name={icon} size={18} color={colors.textPrimary} /> : null}
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        <View style={styles.cardHeaderRight}>
          {typeof countBadge === 'number' ? <View style={styles.countPill}><Text style={styles.countPillText}>{countBadge}</Text></View> : null}
          {rightText ? <View style={styles.countPill}><Text style={styles.countPillText}>{rightText}</Text></View> : null}
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
        </View>
      </Pressable>
      {!open && collapsedChildren ? <View style={styles.cardCollapsed}>{collapsedChildren}</View> : null}
      {open ? <View style={styles.cardBody}>{children}</View> : null}
    </View>
  )
}

function SummaryRow({ icon, label, value, action }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void } }) {
  return (
    <View style={styles.summaryRow}>
      <Ionicons name={icon} size={18} color={colors.textSecondary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
      {action ? (
        <Pressable style={styles.summaryActionBtn} onPress={action.onPress}>
          <Ionicons name={action.icon} size={18} color="#2563EB" />
        </Pressable>
      ) : null}
    </View>
  )
}

function FinCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.finCell}>
      <Text style={styles.finLabel}>{label}</Text>
      <Text style={styles.finValue}>{value || '—'}</Text>
    </View>
  )
}

function TimelineItem({
  icon,
  title,
  subtitle,
  meta,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  subtitle?: string | null
  meta?: string | null
  badge?: string | null
}) {
  return (
    <View style={styles.timelineItem}>
      <Ionicons name={icon} size={18} color={colors.brandPrimary} style={styles.timelineIcon} />
      <View style={styles.timelineBody}>
        <View style={styles.timelineTitleRow}>
          <Text style={styles.timelineTitle}>{title}</Text>
          {badge ? <Text style={styles.timelineBadge}>{badge}</Text> : null}
        </View>
        {subtitle ? <Text style={styles.timelineSubtitle}>{subtitle}</Text> : null}
        {meta ? <Text style={styles.timelineMeta}>{meta}</Text> : null}
      </View>
    </View>
  )
}

export function RequestDetailScreen({ route }: Props) {
  const { requestId } = route.params
  const queryClient = useQueryClient()
  const permissions = useMobilePermissions()
  const allowViewRequests = permissions.canViewRequests()
  const allowEditRequests = permissions.canEditRequests()
  const allowAssignRequests = permissions.canAssignRequests()
  const allowViewFinancials = permissions.canViewRequestFinancials()
  const allowViewEstimates = permissions.canViewRequestEstimates()
  const allowViewCommunication = permissions.canViewRequestCommunication()
  const allowViewActivity = permissions.canViewRequestActivity()
  const allowViewTasksIssues = permissions.canViewRequestTasksIssues()
  const allowViewConvertedClient = permissions.canViewRequestConvertedClient()

  const [isPullRefreshing, setIsPullRefreshing] = React.useState(false)
  const [showAttachmentPicker, setShowAttachmentPicker] = React.useState(false)
  const [showAssignPicker, setShowAssignPicker] = React.useState(false)
  const [localAttachments, setLocalAttachments] = React.useState<AttachmentResponse['attachments']>([])
  const [galleryVisible, setGalleryVisible] = React.useState(false)
  const [galleryIndex, setGalleryIndex] = React.useState(0)
  const [openSummary, setOpenSummary] = React.useState(true)
  const [openDocs, setOpenDocs] = React.useState(false)
  const [openFiles, setOpenFiles] = React.useState(false)
  const [openComms, setOpenComms] = React.useState(false)
  const [openTasks, setOpenTasks] = React.useState(false)
  const [openNotes, setOpenNotes] = React.useState(false)
  const [openMore, setOpenMore] = React.useState(false)

  const detailQuery = useQuery({
    queryKey: ['mobile-request-detail', requestId],
    queryFn: () => apiRequest<RequestDetailResponse>(`/api/leads/${requestId}`),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
    enabled: allowViewRequests,
  })

  const attachmentsQuery = useQuery({
    queryKey: ['mobile-request-attachments', requestId],
    queryFn: () =>
      apiRequest<AttachmentResponse>(
        `/api/attachments?entityType=request&entityId=${encodeURIComponent(requestId)}`
      ),
    enabled: allowViewRequests,
  })

  const teamQuery = useQuery({
    queryKey: ['mobile-request-assignable-team'],
    queryFn: () =>
      apiRequest<{ teamMembers?: TeamMember[]; users?: TeamMember[] }>('/api/schedules/team'),
    enabled: showAssignPicker && allowAssignRequests,
  })

  const urgentMutation = useMutation({
    mutationFn: (isUrgent: boolean) =>
      apiRequest<{ lead: Partial<RequestDetailLead> & { id: string; isUrgent?: boolean } }>(
        `/api/requests/${requestId}/urgent`,
        'PATCH',
        { isUrgent }
      ),
    onMutate: async (nextUrgent) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['mobile-request-detail', requestId] }),
        queryClient.cancelQueries({ queryKey: ['mobile-requests-list'] }),
      ])
      const previousDetail = queryClient.getQueryData<RequestDetailResponse>(['mobile-request-detail', requestId])
      const previousList = queryClient.getQueryData<InfiniteData<{ leads: Array<{ id: string; isUrgent?: boolean }> }>>([
        'mobile-requests-list',
      ])

      queryClient.setQueryData<RequestDetailResponse>(['mobile-request-detail', requestId], (existing) =>
        existing?.lead ? { ...existing, lead: { ...existing.lead, isUrgent: nextUrgent } } : existing
      )
      queryClient.setQueryData<InfiniteData<{ leads: Array<{ id: string; isUrgent?: boolean }> }>>(
        ['mobile-requests-list'],
        (existing) => {
          if (!existing) return existing
          return {
            ...existing,
            pages: existing.pages.map((page) => ({
              ...page,
              leads: (page.leads || []).map((lead) => (lead.id === requestId ? { ...lead, isUrgent: nextUrgent } : lead)),
            })),
          }
        }
      )

      return { previousDetail, previousList }
    },
    onError: (error: any, _nextUrgent, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(['mobile-request-detail', requestId], context.previousDetail)
      }
      if (context?.previousList) {
        queryClient.setQueryData(['mobile-requests-list'], context.previousList)
      }
      Alert.alert('Failed', error?.message || 'Unable to update urgent flag.')
    },
    onSuccess: (payload) => {
      if (!payload?.lead) return
      queryClient.setQueryData<RequestDetailResponse>(['mobile-request-detail', requestId], (existing) => {
        if (!existing?.lead) return existing
        return {
          ...existing,
          lead: {
            ...existing.lead,
            isUrgent: payload.lead.isUrgent,
            urgentAt: payload.lead.urgentAt ?? existing.lead.urgentAt,
            urgentByUserId: payload.lead.urgentByUserId ?? existing.lead.urgentByUserId,
          },
        }
      })
      queryClient.setQueryData<InfiniteData<{ leads: Array<{ id: string; isUrgent?: boolean }> }>>(
        ['mobile-requests-list'],
        (existing) => {
          if (!existing) return existing
          return {
            ...existing,
            pages: existing.pages.map((page) => ({
              ...page,
              leads: (page.leads || []).map((lead) =>
                lead.id === requestId ? { ...lead, isUrgent: payload.lead.isUrgent } : lead
              ),
            })),
          }
        }
      )
    },
  })

  const assignMutation = useMutation({
    mutationFn: (assignedToId: string) =>
      apiRequest<{ lead: { assignedTo?: RequestPerson | null } }>(`/api/leads/${requestId}`, 'PUT', {
        assignedToId,
      }),
    onSuccess: (payload) => {
      queryClient.setQueryData<RequestDetailResponse>(['mobile-request-detail', requestId], (existing) => {
        if (!existing?.lead) return existing
        return {
          ...existing,
          lead: {
            ...existing.lead,
            assignedTo: payload?.lead?.assignedTo ?? existing.lead.assignedTo,
          },
        }
      })
      void detailQuery.refetch()
      Alert.alert('Assigned', 'Request assignee updated.')
    },
    onError: (error: any) => {
      Alert.alert('Assignment failed', error?.message || 'Unable to assign this request.')
    },
  })

  const requestUploadQueue = useAttachmentUploadQueue<{ attachment: AttachmentResponse['attachments'][number] }>({
    startUpload: (file, onProgress) => {
      const task = uploadFileWithProgress<{ attachment: AttachmentResponse['attachments'][number] }>(
        `/api/requests/${requestId}/attachments`,
        file,
        onProgress
      )
      return {
        promise: task.promise.then((result) => result.raw),
        cancel: task.cancel,
      }
    },
    onUploaded: (result) => {
      if (!result.attachment) return
      setLocalAttachments((prev) => [result.attachment, ...prev.filter((item) => item.id !== result.attachment.id)])
      void attachmentsQuery.refetch()
    },
  })

  useFocusEffect(
    React.useCallback(() => {
      if (!allowViewRequests) return () => {}
      void detailQuery.refetch()
      void attachmentsQuery.refetch()
      return () => {}
    }, [allowViewRequests, detailQuery.refetch, attachmentsQuery.refetch])
  )

  const handlePullRefresh = React.useCallback(async () => {
    setIsPullRefreshing(true)
    try {
      await Promise.all([detailQuery.refetch(), attachmentsQuery.refetch()])
    } finally {
      setIsPullRefreshing(false)
    }
  }, [detailQuery.refetch, attachmentsQuery.refetch])

  if (!allowViewRequests) {
    return (
      <AppScreen>
        <View style={styles.loadingWrap}>
          <EmptyState
            icon="lock-closed-outline"
            title="Access restricted"
            description="You don't have permission to view requests."
          />
        </View>
      </AppScreen>
    )
  }

  if (detailQuery.isLoading) {
    return (
      <AppScreen>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brandPrimary} />
          <Text style={styles.loadingText}>Loading request...</Text>
        </View>
      </AppScreen>
    )
  }

  if (detailQuery.isError || !detailQuery.data?.lead) {
    const errorCopy = getRequestDetailsErrorCopy((detailQuery.error as Error | undefined)?.message)
    return (
      <AppScreen>
        <View style={styles.loadingWrap}>
          <EmptyState
            icon="document-text-outline"
            title={errorCopy.title}
            description={errorCopy.description}
          />
          {errorCopy.canRetry ? (
            <Pressable style={styles.retryButton} onPress={() => void detailQuery.refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      </AppScreen>
    )
  }

  const lead = detailQuery.data.lead
  const estimates = lead.estimates || []
  const calls = lead.calls || []
  const smsMessages = lead.smsMessages || []
  const emails = lead.emails || []
  const activities = lead.activities || []
  const tasks = lead.tasks || []
  const issues = lead.issues || []
  const count = lead._count || {}
  const valueNumber =
    lead.value === null || lead.value === undefined || lead.value === ''
      ? null
      : typeof lead.value === 'number'
        ? lead.value
        : Number.parseFloat(String(lead.value))
  const probability = lead.probability ?? null
  const expectedValue =
    valueNumber !== null && probability !== null && Number.isFinite(valueNumber)
      ? valueNumber * (probability / 100)
      : null
  const attachments = [...localAttachments, ...(attachmentsQuery.data?.attachments || [])].filter(
    (item, index, arr) => arr.findIndex((inner) => inner.id === item.id) === index
  )
  const teamMembers = teamQuery.data?.teamMembers || teamQuery.data?.users || []

  const onSelectAttachmentAction = async (
    action: 'take-photo' | 'record-video' | 'choose-photos' | 'choose-videos' | 'choose-audio' | 'choose-document'
  ) => {
    try {
      const picked = await pickAttachmentsByAction(action)
      if (!picked.length) return
      requestUploadQueue.enqueueFiles(picked)
    } catch (error: any) {
      Alert.alert('Attachment selection failed', error?.message || 'Please try again.')
    }
  }

  const openPhone = () => {
    if (!lead.phone) return
    void Linking.openURL(`tel:${lead.phone}`)
  }

  const openEmail = () => {
    if (!lead.email) return
    void Linking.openURL(`mailto:${lead.email}`)
  }

  const fullAddress = lead.jobSiteAddress
    ? `${lead.jobSiteAddress}${lead.jobSiteCity ? `, ${lead.jobSiteCity}` : ''}${lead.jobSiteState ? `, ${lead.jobSiteState}` : ''}${lead.jobSiteZipCode ? ` ${lead.jobSiteZipCode}` : ''}`.trim()
    : null
  const shortAddress = lead.jobSiteAddress
    ? `${lead.jobSiteAddress}${lead.jobSiteCity ? `, ${lead.jobSiteCity}` : ''}`
    : null
  const openMaps = () => {
    if (!fullAddress) return
    const encoded = encodeURIComponent(fullAddress)
    const nativeUrl = Platform.OS === 'android' ? `comgooglemaps://?q=${encoded}` : `googlemaps://?q=${encoded}`
    const webUrl = `https://maps.google.com/?q=${encoded}`
    Linking.canOpenURL(nativeUrl)
      .then((ok) => (ok ? Linking.openURL(nativeUrl) : Linking.openURL(webUrl)))
      .catch(() => Linking.openURL(webUrl))
  }
  const statusHex = LEAD_STATUS_HEX[String(lead.status || '').toUpperCase()] || colors.brandPrimary
  const assignedName = lead.assignedTo ? personName(lead.assignedTo) : null
  // Named by its job site; the contact person is shown below.
  const name = lead.jobSiteAddress?.trim() || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.company || 'Request'
  const commCount = (count.calls ?? calls.length) + (count.smsMessages ?? smsMessages.length) + (count.emails ?? emails.length)
  const taskCount = count.tasks ?? tasks.length
  const issueCount = count.issues ?? issues.length

  const quickActions = [
    lead.phone ? { key: 'call', icon: 'call-outline', label: 'Call', onPress: openPhone } : null,
    lead.email ? { key: 'email', icon: 'mail-outline', label: 'Email', onPress: openEmail } : null,
    allowEditRequests ? { key: 'urgent', icon: 'alert-circle-outline', label: lead.isUrgent ? 'Unmark' : 'Urgent', onPress: () => urgentMutation.mutate(!lead.isUrgent) } : null,
    { key: 'photo', icon: 'camera-outline', label: 'Add Photo', onPress: () => setShowAttachmentPicker(true) },
    allowAssignRequests ? { key: 'assign', icon: 'person-add-outline', label: 'Assign', onPress: () => setShowAssignPicker(true) } : null,
  ].filter(Boolean) as Array<{ key: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }>

  return (
    <AppScreen>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={isPullRefreshing} onRefresh={() => void handlePullRefresh()} />}
      >
        {/* Request overview */}
        <View style={styles.overview}>
          <Text style={styles.overviewName}>{name}</Text>
          {shortAddress ? (
            <Pressable style={styles.addrRow} onPress={openMaps}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.addrText}>{shortAddress}</Text>
            </Pressable>
          ) : null}
          <View style={styles.overviewBadges}>
            {lead.isUrgent ? <Text style={styles.urgentBadge}>URGENT</Text> : null}
            <View style={[styles.statusPill, { backgroundColor: tint(statusHex) }]}>
              <Text style={[styles.statusPillText, { color: statusHex }]}>{formatLabel(lead.status)}</Text>
            </View>
            {lead.jobType ? <Text style={styles.metaBadge}>{formatLabel(lead.jobType)}</Text> : null}
            <Text style={styles.metaBadge}>{formatLabel(lead.source)}</Text>
          </View>
        </View>

        {/* Quick actions */}
        {quickActions.length > 0 && (
          <View style={styles.card}>
            <View style={styles.quickGrid}>
              {quickActions.map((a) => (
                <Pressable key={a.key} style={styles.quickAction} onPress={a.onPress}>
                  <Ionicons name={a.icon} size={22} color={colors.brandPrimary} />
                  <Text style={styles.quickLabel}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
            {requestUploadQueue.items.length > 0 && (
              <View style={styles.cardBody}>
                <AttachmentUploadQueue
                  items={requestUploadQueue.items}
                  onRetry={(item) => requestUploadQueue.retryItem(item.id)}
                  onRemove={(item) => requestUploadQueue.removeItem(item.id)}
                  onCancel={(item) => requestUploadQueue.cancelItem(item.id)}
                />
              </View>
            )}
          </View>
        )}

        {/* Summary (collapsible) */}
        <CollapsibleCard title="Summary" open={openSummary} onToggle={() => setOpenSummary((v) => !v)}>
          <SummaryRow icon="person-outline" label="Contact" value={`${lead.firstName || ''} ${lead.lastName || ''}`.trim() || '—'} />
          {lead.company ? <SummaryRow icon="business-outline" label="Company" value={lead.company} /> : null}
          {lead.phone ? <SummaryRow icon="call-outline" label="Phone" value={lead.phone} action={{ icon: 'call', onPress: openPhone }} /> : null}
          {lead.email ? <SummaryRow icon="mail-outline" label="Email" value={lead.email} action={{ icon: 'mail', onPress: openEmail }} /> : null}
          {fullAddress ? <SummaryRow icon="location-outline" label="Job Site Address" value={fullAddress} action={{ icon: 'navigate', onPress: openMaps }} /> : null}
          {allowViewFinancials && (lead.value || probability !== null) ? (
            <View style={styles.finCard}>
              <Text style={styles.finTitle}>Financial Summary</Text>
              <View style={styles.finRow}>
                <FinCell label="Est. Value" value={formatCurrency(lead.value)} />
                <FinCell label="Probability" value={probability !== null ? `${probability}%` : '—'} />
                <FinCell label="Expected" value={formatCurrency(expectedValue)} />
              </View>
            </View>
          ) : null}
        </CollapsibleCard>

        {/* Estimates (collapsible) */}
        {allowViewEstimates ? (
          <CollapsibleCard
            icon="document-text-outline"
            title="Estimates"
            countBadge={count.estimates ?? estimates.length}
            open={openDocs}
            onToggle={() => setOpenDocs((v) => !v)}
            collapsedChildren={<Text style={styles.emptyHint}>{estimates.length === 0 ? 'No estimates' : `${estimates.length} estimate${estimates.length === 1 ? '' : 's'} — tap to view`}</Text>}
          >
            {estimates.length === 0 ? (
              <Text style={styles.emptyText}>No estimates</Text>
            ) : (
              estimates.map((estimate) => (
                <View key={estimate.id} style={styles.listCard}>
                  <View style={styles.listCardMain}>
                    <Text style={styles.listCardTitle}>{estimate.estimateNumber}</Text>
                    <Text style={styles.listCardSubtitle}>{estimate.title}</Text>
                  </View>
                  <View style={styles.listCardSide}>
                    <Text style={styles.listCardAmount}>{formatCurrency(estimate.total)}</Text>
                    <Text style={styles.metaBadge}>{formatLabel(estimate.status)}</Text>
                  </View>
                </View>
              ))
            )}
          </CollapsibleCard>
        ) : null}

        {/* Files & Photos (collapsible) */}
        <CollapsibleCard
          icon="images-outline"
          title="Files & Photos"
          countBadge={attachments.length}
          open={openFiles}
          onToggle={() => setOpenFiles((v) => !v)}
          collapsedChildren={<Text style={styles.emptyHint}>{attachments.length === 0 ? 'No files yet' : `${attachments.length} file${attachments.length === 1 ? '' : 's'} — tap to view`}</Text>}
        >
          <Pressable style={styles.addFileBtn} onPress={() => setShowAttachmentPicker(true)}>
            <Ionicons name="add" size={16} color={colors.brandPrimary} />
            <Text style={styles.addFileText}>Add photo or file</Text>
          </Pressable>
          {attachments.length === 0 ? (
            <Text style={styles.emptyHint}>No files or photos for this request yet.</Text>
          ) : (
            <View style={styles.mediaGrid}>
              {attachments.map((a) => {
                const mime = String(a.mimeType || '').toLowerCase()
                const isImage = mime.startsWith('image/')
                const isVideo = mime.startsWith('video/')
                const isPdf = isPdfAttachment(a.mimeType, a.fileName)
                const previewUrl = String(a.thumbnailUrl || a.previewUrl || '').trim() || null
                return (
                  <View key={a.id} style={styles.mediaTileWrap}>
                    <AttachmentOpenPressable
                      attachment={a}
                      onOpenGallery={() => {
                        const idx = attachments.findIndex((x) => x.id === a.id)
                        setGalleryIndex(Math.max(0, idx))
                        setGalleryVisible(true)
                      }}
                    >
                      <View style={styles.mediaTile}>
                        {isImage ? (
                          <Image source={{ uri: a.url }} style={styles.mediaTileImage} />
                        ) : isPdf && previewUrl ? (
                          <Image source={{ uri: previewUrl }} style={styles.mediaTileImage} />
                        ) : (
                          <View style={styles.mediaTileIcon}>
                            <Ionicons name={isVideo ? 'videocam-outline' : isPdf ? 'document-outline' : 'document-text-outline'} size={24} color={colors.textSecondary} />
                            <Text style={styles.mediaFileBadge}>{isVideo ? 'VIDEO' : isPdf ? 'PDF' : 'FILE'}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.mediaFileName} numberOfLines={1}>{a.fileName || (isPdf ? 'PDF' : isVideo ? 'Video' : 'File')}</Text>
                    </AttachmentOpenPressable>
                  </View>
                )
              })}
            </View>
          )}
        </CollapsibleCard>

        {/* Communication (collapsible) */}
        {allowViewCommunication ? (
          <CollapsibleCard
            icon="chatbubbles-outline"
            title="Communication"
            countBadge={commCount}
            open={openComms}
            onToggle={() => setOpenComms((v) => !v)}
            collapsedChildren={<Text style={styles.emptyHint}>{commCount === 0 ? 'No communication history' : 'Calls, SMS and emails — tap to view'}</Text>}
          >
            {calls.slice(0, 5).map((call) => (
              <TimelineItem
                key={call.id}
                icon="call-outline"
                title={`${call.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} Call`}
                subtitle={`${call.fromNumber} → ${call.toNumber}`}
                meta={`${formatDate(call.startedAt) || ''} • ${formatDuration(call.duration)}`}
                badge={call.status}
              />
            ))}
            {smsMessages.slice(0, 5).map((sms) => (
              <TimelineItem
                key={sms.id}
                icon="chatbubble-outline"
                title={`${sms.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} SMS`}
                subtitle={sms.body ? (sms.body.length > 100 ? `${sms.body.slice(0, 100)}...` : sms.body) : 'No content'}
                meta={sms.sentAt ? formatDate(sms.sentAt) : 'Pending'}
              />
            ))}
            {emails.slice(0, 5).map((email) => (
              <TimelineItem
                key={email.id}
                icon="mail-outline"
                title={email.subject || 'Email'}
                subtitle={email.direction === 'INBOUND' ? 'Received' : 'Sent'}
                meta={email.sentAt ? formatDate(email.sentAt) : 'Draft'}
                badge={email.status}
              />
            ))}
            {commCount === 0 ? <Text style={styles.emptyText}>No communication history</Text> : null}
          </CollapsibleCard>
        ) : null}

        {/* Tasks & Issues (collapsible) */}
        {allowViewTasksIssues ? (
          <CollapsibleCard
            icon="checkbox-outline"
            title="Tasks & Issues"
            rightText={`${taskCount} / ${issueCount}`}
            open={openTasks}
            onToggle={() => setOpenTasks((v) => !v)}
            collapsedChildren={<Text style={styles.emptyHint}>{taskCount + issueCount === 0 ? 'No tasks or issues' : `${taskCount} task${taskCount === 1 ? '' : 's'}, ${issueCount} issue${issueCount === 1 ? '' : 's'}`}</Text>}
          >
            {tasks.length === 0 && issues.length === 0 ? (
              <Text style={styles.emptyText}>No tasks or issues</Text>
            ) : (
              <>
                {tasks.map((task) => (
                  <View key={task.id} style={styles.listCard}>
                    <View style={styles.listCardMain}>
                      <Text style={styles.listCardTitle}>{task.title}</Text>
                      <Text style={styles.listCardSubtitle}>
                        {formatLabel(task.status)}{task.dueDate ? ` • Due ${formatDate(task.dueDate)}` : ''}
                      </Text>
                    </View>
                    {task.priority ? <Text style={styles.metaBadge}>{formatLabel(task.priority)}</Text> : null}
                  </View>
                ))}
                {issues.map((issue) => (
                  <View key={issue.id} style={styles.listCard}>
                    <View style={styles.listCardMain}>
                      <Text style={styles.listCardTitle}>{issue.title}</Text>
                      <Text style={styles.listCardSubtitle}>{formatLabel(issue.status)}</Text>
                    </View>
                    {issue.priority ? <Text style={styles.metaBadge}>{formatLabel(issue.priority)}</Text> : null}
                  </View>
                ))}
              </>
            )}
          </CollapsibleCard>
        ) : null}

        {/* Notes (collapsible) */}
        {lead.notes ? (
          <CollapsibleCard icon="reader-outline" title="Notes" open={openNotes} onToggle={() => setOpenNotes((v) => !v)} collapsedChildren={<Text style={styles.emptyHint}>Tap to view notes…</Text>}>
            <Text style={styles.notesText}>{lead.notes}</Text>
          </CollapsibleCard>
        ) : null}

        {/* More details (collapsible) */}
        <CollapsibleCard
          icon="ellipsis-horizontal-circle-outline"
          title="More Details"
          open={openMore}
          onToggle={() => setOpenMore((v) => !v)}
          collapsedChildren={<Text style={styles.emptyHint}>Assignee, converted client, activity, stats…</Text>}
        >
          <DetailSection
            title="Assigned To"
            right={
              allowAssignRequests ? (
                <Pressable style={styles.assignButton} onPress={() => setShowAssignPicker(true)}>
                  <Ionicons name="person-add-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.assignButtonText}>Assign</Text>
                </Pressable>
              ) : undefined
            }
          >
            {lead.assignedTo ? (
              <>
                <DetailRow label="Name" value={assignedName} />
                <DetailRow label="Email" value={lead.assignedTo.email} />
                <Pressable onPress={() => callPhone(lead.assignedTo?.phone)}>
                  <DetailRow label="Phone (tap to call)" value={lead.assignedTo.phone} />
                </Pressable>
              </>
            ) : (
              <Text style={styles.emptyText}>Unassigned</Text>
            )}
          </DetailSection>

          {allowViewConvertedClient && lead.convertedToClientId && lead.client ? (
            <DetailSection title="Converted Client">
              <DetailRow label="Client" value={lead.client.name} />
              <DetailRow label="Company" value={lead.client.companyName} />
              <DetailRow label="Converted" value={formatDate(lead.convertedAt)} />
            </DetailSection>
          ) : null}

          {allowViewActivity && activities.length > 0 ? (
            <DetailSection title="Activity Timeline">
              {activities.map((activity) => (
                <View key={activity.id} style={styles.activityItem}>
                  <Text style={styles.timelineSubtitle}>{activity.description}</Text>
                  <Text style={styles.timelineMeta}>
                    {activity.user ? `${activity.user.firstName || ''} ${activity.user.lastName || ''}`.trim() || 'System' : 'System'}
                    {' • '}
                    {formatDate(activity.createdAt)}
                  </Text>
                </View>
              ))}
            </DetailSection>
          ) : null}

          <DetailSection title="Statistics">
            <View style={styles.statsGrid}>
              <View style={styles.statCell}><Text style={styles.statValue}>{count.estimates ?? 0}</Text><Text style={styles.statLabel}>Estimates</Text></View>
              <View style={styles.statCell}><Text style={styles.statValue}>{count.tasks ?? 0}</Text><Text style={styles.statLabel}>Tasks</Text></View>
              <View style={styles.statCell}><Text style={styles.statValue}>{count.calls ?? 0}</Text><Text style={styles.statLabel}>Calls</Text></View>
              <View style={styles.statCell}><Text style={styles.statValue}>{count.smsMessages ?? 0}</Text><Text style={styles.statLabel}>Messages</Text></View>
            </View>
          </DetailSection>

          <DetailSection title="Request Info">
            <DetailRow label="Created" value={formatDate(lead.createdAt)} />
            <DetailRow label="Source" value={formatLabel(lead.source)} />
            {lead.jobType ? <DetailRow label="Job Type" value={formatLabel(lead.jobType)} /> : null}
            <DetailRow label="Request ID" value={lead.id} />
          </DetailSection>
        </CollapsibleCard>
      </ScrollView>

      <AttachmentGalleryModal
        visible={galleryVisible}
        attachments={attachments.map((row) => ({
          id: row.id,
          fileName: row.fileName || 'Attachment',
          fileSize: row.fileSize,
          mimeType: row.mimeType || 'application/octet-stream',
          url: normalizeAttachmentUrl(row.url) || row.url,
        }))}
        index={galleryIndex}
        onClose={() => setGalleryVisible(false)}
        onIndexChange={setGalleryIndex}
        entityType="request"
        entityId={requestId}
        onAttachmentCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['mobile-request-attachments', requestId] })
        }}
      />

      <Modal visible={showAssignPicker} transparent animationType="fade" onRequestClose={() => setShowAssignPicker(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAssignPicker(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Assign Request</Text>
            <ScrollView style={styles.modalScroll}>
              {teamQuery.isLoading ? <Text style={styles.emptyText}>Loading team...</Text> : null}
              {!teamQuery.isLoading && teamMembers.length === 0 ? (
                <Text style={styles.emptyText}>No team members available.</Text>
              ) : null}
              {teamMembers.map((member) => {
                const active = lead.assignedTo?.id === member.id
                return (
                  <Pressable
                    key={member.id}
                    style={[styles.modalRow, active && styles.modalRowActive]}
                    disabled={assignMutation.isPending || active}
                    onPress={() => {
                      setShowAssignPicker(false)
                      assignMutation.mutate(member.id)
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalRowTitle}>
                        {member.firstName} {member.lastName}
                      </Text>
                      <Text style={styles.modalRowMeta}>
                        {[member.role, member.email].filter(Boolean).join(' • ')}
                      </Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark" size={18} color={colors.brandPrimary} />
                    ) : (
                      <Ionicons name="person-add-outline" size={18} color={colors.brandPrimary} />
                    )}
                  </Pressable>
                )
              })}
            </ScrollView>
            <Pressable style={styles.modalCloseButton} onPress={() => setShowAssignPicker(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <AttachmentPickerSheet
        visible={showAttachmentPicker}
        onClose={() => setShowAttachmentPicker(false)}
        onSelect={onSelectAttachmentAction}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  retryButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.brandPrimary,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...typography.sub,
    color: colors.surface,
    fontWeight: '600',
  },
  content: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  scrollView: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },

  overview: { paddingHorizontal: spacing.xs, paddingTop: spacing.xs, gap: 6 },
  overviewName: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
  overviewBadges: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addrText: { ...typography.sub, color: colors.textSecondary },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusPillText: { ...typography.caption, fontWeight: '800' },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800' },
  countPill: { backgroundColor: '#EEF2F7', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2, minWidth: 28, alignItems: 'center' },
  countPillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '800' },
  cardCollapsed: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm, gap: spacing.sm },
  quickAction: { flexGrow: 1, flexBasis: '20%', minWidth: 68, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F1F5F9', borderRadius: radius.md, paddingVertical: spacing.sm },
  quickLabel: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },

  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  summaryLabel: { ...typography.caption, color: colors.muted, fontWeight: '600' },
  summaryValue: { ...typography.sub, color: colors.textPrimary, fontWeight: '600' },
  summaryActionBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },

  finCard: { marginTop: spacing.sm, backgroundColor: '#F8FAFC', borderRadius: radius.md, padding: spacing.md },
  finTitle: { ...typography.caption, color: colors.muted, fontWeight: '700', marginBottom: 6 },
  finRow: { flexDirection: 'row' },
  finCell: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider, paddingHorizontal: 8 },
  finLabel: { ...typography.caption, color: colors.textSecondary },
  finValue: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', marginTop: 2 },

  emptyHint: { ...typography.caption, color: colors.muted },

  addFileBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, marginBottom: spacing.sm },
  addFileText: { ...typography.caption, color: colors.brandPrimary, fontWeight: '700' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  mediaTileWrap: { width: '33.333%', padding: spacing.xs },
  mediaTile: { aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: colors.divider, alignItems: 'center', justifyContent: 'center' },
  mediaTileImage: { width: '100%', height: '100%' },
  mediaTileIcon: { alignItems: 'center', gap: 4 },
  mediaFileBadge: { ...typography.caption, color: colors.muted, fontSize: 9, fontWeight: '800' },
  mediaFileName: { ...typography.caption, color: colors.textSecondary, fontSize: 11, marginTop: 4 },

  name: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  companyText: {
    ...typography.sub,
    color: colors.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  urgentBadge: {
    ...typography.caption,
    color: '#B91C1C',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontWeight: '700',
  },
  statusBadge: {
    ...typography.caption,
    color: colors.brandPrimary,
    backgroundColor: '#E8EEF1',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontWeight: '700',
  },
  metaBadge: {
    ...typography.caption,
    color: colors.textSecondary,
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  actionChipActive: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  actionChipText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  actionChipTextActive: {
    color: '#B91C1C',
  },
  notesText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  listCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    padding: spacing.sm,
    backgroundColor: '#F8FAFC',
  },
  listCardMain: {
    flex: 1,
    gap: 2,
  },
  listCardSide: {
    alignItems: 'flex-end',
    gap: 4,
  },
  listCardTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  listCardSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  listCardAmount: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  timelineItem: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  timelineIcon: {
    marginTop: 2,
  },
  timelineBody: {
    flex: 1,
    gap: 2,
  },
  timelineTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  timelineTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '600',
    flex: 1,
  },
  timelineSubtitle: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  timelineMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  timelineBadge: {
    ...typography.caption,
    color: colors.textSecondary,
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontWeight: '600',
  },
  activityItem: {
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    paddingLeft: spacing.sm,
    gap: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCell: {
    width: '47%',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    padding: spacing.sm,
    backgroundColor: '#F8FAFC',
  },
  statValue: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  assignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  assignButtonText: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  sectionTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  emptyAttachments: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  attachmentRow: {
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  attachmentCard: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#E5E7EB',
  },
  attachmentIconWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
  },
  attachmentFileBadge: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerClose: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  viewerCloseText: {
    ...typography.sub,
    color: '#fff',
    fontWeight: '600',
  },
  viewerImage: {
    flex: 1,
    width: '100%',
  },
  viewerVideo: {
    flex: 1,
    width: '100%',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    maxHeight: '75%',
  },
  modalTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  modalScroll: {
    maxHeight: 360,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalRowActive: {
    backgroundColor: '#F8FAFC',
  },
  modalRowTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  modalRowMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  modalCloseButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  modalCloseText: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '600',
  },
})
