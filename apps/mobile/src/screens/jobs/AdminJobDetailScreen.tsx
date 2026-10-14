import React, { useState } from 'react'
import {
  Alert,
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
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { DetailSection } from '../../components/DetailSection'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { StatusBadge } from '../../components/StatusBadge'
import { BillingStatusBadge } from '../../components/BillingStatusBadge'
import { AttachmentPickerSheet } from '../../components/attachments/AttachmentPickerSheet'
import { AttachmentUploadQueue } from '../../components/attachments/AttachmentUploadQueue'
import { pickAttachmentsByAction, uploadFileWithProgress } from '../../services/attachment-upload'
import { useAttachmentUploadQueue } from '../../hooks/useAttachmentUploadQueue'
import { JobsStackParamList } from '../../types/navigation'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { Job, TimeEntry, Attachment } from '../../types/models'
import { formatMoney } from '../../utils/format'
import {
  JobBillingSummarySection,
  JobClientSection,
  JobCrewSection,
  JobDocumentsSection,
  JobInformationSection,
  JobNotesHistorySection,
  JobSchedulesSection,
  JobTasksIssuesSection,
  JobTimeEntriesSection,
} from './jobDetailSections'

type Props = NativeStackScreenProps<JobsStackParamList, 'AdminJobDetail'>

const JOB_STATUS_OPTIONS = [
  'QUOTE', 'SCHEDULED', 'IN_PROGRESS', 'MEASURED', 'NEED_TO_ORDER', 'ORDERED',
  'INSTALLATION_COMPLETE', 'NEED_TOUCH_UPS', 'FINISHING_COMPLETE', 'COMPLETED', 'ON_HOLD', 'CANCELLED', 'INVOICED',
]
function formatStatusLabel(status: string) {
  return status.replaceAll('_', ' ')
}
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
interface JobResponse { job: Job }
interface JobTimeResponse { entries: TimeEntry[]; activeEntries: TimeEntry[]; summary: { totalMinutes: number; billableHours: number; billableAmountCents: number } }

export function AdminJobDetailScreen({ route, navigation }: Props) {
  const { jobId } = route.params
  const queryClient = useQueryClient()
  const perms = useMobilePermissions()
  const {
    canEditJobs, canAssignJobs, canScheduleJobs, canChangeJobStatus, canCreateTasks,
    canViewJobFinancials, canViewJobDocuments, canViewJobBilling, canViewJobTimeEntries,
    canViewJobNotes, canViewJobCrew, canViewJobSchedules, canViewJobClientDetails, canViewJobTasksIssues,
  } = perms

  const [statusPickerVisible, setStatusPickerVisible] = useState(false)
  const [assignPickerVisible, setAssignPickerVisible] = useState(false)
  const [attachmentPickerVisible, setAttachmentPickerVisible] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [openSummary, setOpenSummary] = useState(true)
  const [openDocs, setOpenDocs] = useState(false)
  const [openTasks, setOpenTasks] = useState(false)
  const [openNotes, setOpenNotes] = useState(false)
  const [openMore, setOpenMore] = useState(false)

  const jobQuery = useQuery({
    queryKey: ['admin-job', jobId],
    queryFn: () => apiRequest<JobResponse>(`/api/mobile/jobs/${jobId}`),
    refetchInterval: 45_000,
  })
  const timeQuery = useQuery({
    queryKey: ['admin-job-time', jobId],
    queryFn: () => apiRequest<JobTimeResponse>(`/api/jobs/${jobId}/time`),
    enabled: !!jobQuery.data?.job && canViewJobTimeEntries(),
    refetchInterval: 45_000,
  })
  const usersQuery = useQuery({
    queryKey: ['assignable-users', jobId],
    queryFn: () => apiRequest<{ users: Array<{ id: string; firstName: string; lastName: string; role: string; status?: string | null }> }>('/api/users?limit=200'),
    enabled: assignPickerVisible,
  })

  const job = jobQuery.data?.job
  const assignments = asArray<NonNullable<Job['assignments']>[number]>(job?.assignments)

  const statusMutation = useMutation({
    mutationFn: async (status: string) => { await apiRequest(`/api/jobs/${jobId}`, 'PUT', { status }) },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-job', jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['production-board'] })
      Alert.alert('Success', 'Job status updated')
    },
    onError: (error: any) => Alert.alert('Error', error?.message || 'Failed to update status'),
  })
  const assignMutation = useMutation({
    mutationFn: async (userId: string) => { await apiRequest(`/api/jobs/${jobId}/assignments`, 'POST', { userId }) },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-job', jobId] }),
        queryClient.invalidateQueries({ queryKey: ['all-jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-assignments'] }),
      ])
      Alert.alert('Success', 'Crew member assigned to job.')
    },
    onError: (error: any) => Alert.alert('Assignment failed', error?.message || 'Unable to assign crew member.'),
  })

  const jobUploadQueue = useAttachmentUploadQueue<{ attachment: Attachment }>({
    startUpload: (file, onProgress) => {
      const task = uploadFileWithProgress<{ attachment: Attachment }>(`/api/jobs/${jobId}/attachments`, file, onProgress)
      return { promise: task.promise.then((result) => result.raw), cancel: task.cancel }
    },
    onUploaded: () => { queryClient.invalidateQueries({ queryKey: ['admin-job', jobId] }) },
  })

  const onRefresh = async () => { await Promise.all([jobQuery.refetch(), timeQuery.refetch()]) }

  if (jobQuery.isError) {
    return (
      <AppScreen>
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>Unable to load job details.</Text>
          <Pressable style={styles.retryButton} onPress={() => jobQuery.refetch()}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      </AppScreen>
    )
  }
  if (!job) {
    return <AppScreen><View style={styles.centerContainer}><Text style={styles.loadingText}>Loading job...</Text></View></AppScreen>
  }

  const site = job.jobSite || job.address
  const fullAddress = site?.street ? `${site.street}${site.city ? `, ${site.city}` : ''}${site.state ? `, ${site.state}` : ''}${site.zipCode ? ` ${site.zipCode}` : ''}`.trim() : null
  const shortAddress = site?.street ? `${site.street}${site.city ? `, ${site.city}` : ''}` : null
  const phone = job.client?.phone || job.client?.contacts?.[0]?.phone || null

  const openMaps = () => {
    if (!fullAddress) return
    const encoded = encodeURIComponent(fullAddress)
    const nativeUrl = Platform.OS === 'android' ? `comgooglemaps://?q=${encoded}` : `googlemaps://?q=${encoded}`
    const webUrl = `https://maps.google.com/?q=${encoded}`
    Linking.canOpenURL(nativeUrl).then((ok) => (ok ? Linking.openURL(nativeUrl) : Linking.openURL(webUrl))).catch(() => Linking.openURL(webUrl))
  }
  const callClient = () => {
    if (!phone) { Alert.alert('No phone number', 'This client does not have a phone number on file.'); return }
    Linking.openURL(`tel:${phone}`)
  }
  const sendMessage = async () => {
    if (busyAction) return
    setBusyAction('message')
    try {
      const thread = await apiRequest<{ conversationId: string }>('/api/messages/job/ensure', 'POST', { jobId: job.id })
      const rootNav: any = navigation.getParent()?.getParent() || navigation.getParent()
      rootNav?.navigate('MainTabs', {
        screen: 'MessagesTab',
        params: { screen: 'MessageThread', params: { conversationId: thread.conversationId, jobContext: { jobId: job.id, jobNumber: job.jobNumber, jobName: job.title } } },
      })
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to open job chat')
    } finally { setBusyAction(null) }
  }
  const addTask = async () => {
    if (busyAction) return
    if (!canCreateTasks()) { Alert.alert('Permission denied', 'You do not have permission to create tasks.'); return }
    setBusyAction('task')
    try {
      const usersResponse = await apiRequest<{ users: Array<{ id: string; role: string; firstName: string; lastName: string }> }>('/api/users?role=ADMIN&limit=10')
      const adminUsers = usersResponse.users.filter((u) => u.role === 'ADMIN' || u.role === 'OFFICE')
      if (adminUsers.length === 0) { Alert.alert('No admin users', 'No admin users found to assign the task to.'); return }
      await apiRequest('/api/tasks?mobile=true', 'POST', {
        title: `Task for ${job.jobNumber}`,
        description: `Task created from job ${job.jobNumber}: ${job.title}`,
        assigneeId: adminUsers[0].id, jobId: job.id, priority: 'MEDIUM', status: 'TODO',
      })
      Alert.alert('Success', `Task created and assigned to ${adminUsers[0].firstName} ${adminUsers[0].lastName}`)
      queryClient.invalidateQueries({ queryKey: ['admin-job', jobId] })
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to create task')
    } finally { setBusyAction(null) }
  }
  const onSelectAttachment = async (action: any) => {
    setAttachmentPickerVisible(false)
    try {
      const picked = await pickAttachmentsByAction(action)
      if (picked?.length) jobUploadQueue.enqueueFiles(picked)
    } catch (error: any) {
      Alert.alert('Attachment error', error?.message || 'Could not add the file.')
    }
  }
  const schedule = () => {
    if (!canScheduleJobs()) { Alert.alert('Permission denied', 'You do not have permission to schedule jobs.'); return }
    const rootNav: any = navigation.getParent()?.getParent() || navigation.getParent()
    rootNav?.navigate('MainTabs', {
      screen: 'ScheduleTab',
      params: { screen: 'ScheduleCreate', params: { jobId: job.id, assignedUserId: assignments[0]?.user?.id, title: `${job.jobNumber} - ${job.title}` } },
    })
  }

  const assignedUserIds = new Set(assignments.map((entry) => entry.user.id))
  const assignableUsers = (usersQuery.data?.users || []).filter((entry) => {
    if (assignedUserIds.has(entry.id)) return false
    const status = String(entry.status || '').toUpperCase()
    if (status && status !== 'ACTIVE') return false
    const role = String(entry.role || '').toUpperCase()
    return role === 'ADMIN' || role === 'OFFICE' || role === 'FIELD'
  })

  const estCount = job.estimates?.length ?? 0
  const invCount = job.invoices?.length ?? 0
  const payCount = job.payments?.length ?? 0
  const poCount = job.purchaseOrders?.length ?? 0
  const docTotal = estCount + invCount + payCount + poCount
  const taskCount = job._count?.tasks ?? job.tasks?.length ?? 0
  const issueCount = job._count?.issues ?? job.issues?.length ?? 0

  // Quick actions the current user may use (shown as a responsive grid).
  const quickActions = [
    { key: 'message', icon: 'chatbubble-ellipses-outline', label: 'Message', onPress: sendMessage, show: true },
    { key: 'task', icon: 'clipboard-outline', label: 'Add Task', onPress: addTask, show: canCreateTasks() },
    { key: 'photo', icon: 'camera-outline', label: 'Add Photo', onPress: () => setAttachmentPickerVisible(true), show: canEditJobs() || canViewJobDocuments() },
    { key: 'schedule', icon: 'calendar-outline', label: 'Schedule', onPress: schedule, show: canScheduleJobs() },
  ].filter((a) => a.show)

  return (
    <AppScreen>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={jobQuery.isRefetching || timeQuery.isRefetching} onRefresh={onRefresh} />}
      >
        {/* Job overview */}
        <View style={styles.overview}>
          <Text style={styles.jobNumber}>{job.jobNumber}</Text>
          {shortAddress ? (
            <Pressable style={styles.addrRow} onPress={openMaps}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.addrText}>{shortAddress}</Text>
            </Pressable>
          ) : null}
          <View style={styles.badgeRow}>
            <StatusBadge status={job.status} />
            <BillingStatusBadge status={job.billingStatus} />
          </View>
        </View>

        {/* Quick actions */}
        {quickActions.length > 0 && (
          <View style={styles.card}>
            <View style={styles.quickGrid}>
              {quickActions.map((a) => (
                <Pressable key={a.key} style={styles.quickAction} onPress={a.onPress} disabled={busyAction === a.key}>
                  <Ionicons name={a.icon as any} size={22} color={colors.brandPrimary} />
                  <Text style={styles.quickLabel}>{busyAction === a.key ? '…' : a.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Job summary (collapsible) */}
        <CollapsibleCard title="Job Summary" open={openSummary} onToggle={() => setOpenSummary((v) => !v)}>
          <SummaryRow icon="person-outline" label="Client" value={job.client?.name || 'No client'} />
          {phone ? (
            <SummaryRow icon="call-outline" label="Phone" value={phone} action={{ icon: 'call', onPress: callClient }} />
          ) : null}
          {fullAddress ? (
            <SummaryRow icon="location-outline" label="Job Site Address" value={fullAddress} action={{ icon: 'navigate', onPress: openMaps }} />
          ) : null}
          {canViewJobFinancials() && (
            <View style={styles.finCard}>
              <Text style={styles.finTitle}>Financial Summary</Text>
              <View style={styles.finRow}>
                <FinCell label="Estimate" value={formatMoney(job.estimateAmount)} />
                <FinCell label="Invoiced" value={formatMoney(job.totalInvoicedAmount)} />
                <FinCell label="Balance" value={formatMoney(job.openInvoiceBalance)} />
              </View>
            </View>
          )}
        </CollapsibleCard>

        {/* Documents (collapsible, with category chips) */}
        {canViewJobDocuments() && (
          <CollapsibleCard
            icon="document-text-outline"
            title="Documents"
            countBadge={docTotal}
            open={openDocs}
            onToggle={() => setOpenDocs((v) => !v)}
            collapsedChildren={
              <View style={styles.chipRow}>
                <Chip label="Estimates" count={estCount} />
                <Chip label="Invoices" count={invCount} />
                <Chip label="Payments" count={payCount} />
                {poCount > 0 ? <Chip label="POs" count={poCount} /> : null}
              </View>
            }
          >
            <JobDocumentsSection job={job} />
          </CollapsibleCard>
        )}

        {/* Tasks & Issues (collapsible) */}
        {canViewJobTasksIssues() && (
          <CollapsibleCard
            icon="checkbox-outline"
            title="Tasks & Issues"
            rightText={`${taskCount} / ${issueCount}`}
            open={openTasks}
            onToggle={() => setOpenTasks((v) => !v)}
            collapsedChildren={taskCount + issueCount === 0 ? <Text style={styles.emptyHint}>No tasks or issues</Text> : <Text style={styles.emptyHint}>{taskCount} open task{taskCount === 1 ? '' : 's'}, {issueCount} issue{issueCount === 1 ? '' : 's'}</Text>}
          >
            <JobTasksIssuesSection job={job} showLists />
          </CollapsibleCard>
        )}

        {/* Notes (collapsible) */}
        {canViewJobNotes() && (
          <CollapsibleCard icon="reader-outline" title="Notes" open={openNotes} onToggle={() => setOpenNotes((v) => !v)} collapsedChildren={<Text style={styles.emptyHint}>Tap to view and add notes…</Text>}>
            <JobNotesHistorySection job={job} />
          </CollapsibleCard>
        )}

        {/* More details (status, crew, schedule, time, billing, info, client) */}
        <CollapsibleCard icon="ellipsis-horizontal-circle-outline" title="More Details" open={openMore} onToggle={() => setOpenMore((v) => !v)} collapsedChildren={<Text style={styles.emptyHint}>Status, crew, schedule, time, billing…</Text>}>
          {canChangeJobStatus() && (
            <DetailSection title="Status">
              <Pressable style={styles.statusSelectTrigger} onPress={() => setStatusPickerVisible(true)} disabled={statusMutation.isPending}>
                <Text style={styles.statusSelectValue}>{formatStatusLabel(job.status)}</Text>
                <Ionicons name="chevron-down" size={18} color={colors.textPrimary} />
              </Pressable>
            </DetailSection>
          )}
          <JobInformationSection job={job} showFinancials={canViewJobFinancials()} />
          {canViewJobBilling() ? <JobBillingSummarySection job={job} /> : null}
          {canViewJobTimeEntries() ? (
            <JobTimeEntriesSection entries={asArray<TimeEntry>(timeQuery.data?.entries)} activeTimers={job.activeTimers} loading={timeQuery.isLoading} />
          ) : null}
          {canViewJobCrew() || canAssignJobs() ? (
            <JobCrewSection
              job={job}
              right={canAssignJobs() ? (
                <Pressable style={styles.assignButton} onPress={() => setAssignPickerVisible(true)}>
                  <Ionicons name="person-add-outline" size={18} color={colors.brandPrimary} />
                  <Text style={styles.assignButtonText}>Assign</Text>
                </Pressable>
              ) : undefined}
            />
          ) : null}
          {canViewJobClientDetails() ? <JobClientSection job={job} /> : null}
          {canViewJobSchedules() ? <JobSchedulesSection job={job} /> : null}
        </CollapsibleCard>

        {jobUploadQueue.items.length > 0 && (
          <View style={styles.card}>
            <AttachmentUploadQueue
              items={jobUploadQueue.items}
              onRetry={(item) => jobUploadQueue.retryItem(item.id)}
              onRemove={(item) => jobUploadQueue.removeItem(item.id)}
              onCancel={(item) => jobUploadQueue.cancelItem(item.id)}
            />
          </View>
        )}

        {/* Status picker */}
        <Modal visible={statusPickerVisible} transparent animationType="fade" onRequestClose={() => setStatusPickerVisible(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setStatusPickerVisible(false)} />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Update Job Status</Text>
              <ScrollView style={{ maxHeight: 360 }}>
                {JOB_STATUS_OPTIONS.map((status) => {
                  const active = status === job.status
                  return (
                    <Pressable key={status} style={[styles.modalRow, active && styles.modalRowActive]} onPress={() => { setStatusPickerVisible(false); if (!active) statusMutation.mutate(status) }}>
                      <Text style={styles.modalRowTitle}>{formatStatusLabel(status)}</Text>
                      {active ? <Ionicons name="checkmark" size={18} color={colors.brandPrimary} /> : null}
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Assign crew */}
        <Modal visible={assignPickerVisible} transparent animationType="fade" onRequestClose={() => setAssignPickerVisible(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setAssignPickerVisible(false)} />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Assign Crew</Text>
              <ScrollView style={{ maxHeight: 360 }}>
                {usersQuery.isLoading ? <Text style={styles.emptyText}>Loading users...</Text> : null}
                {!usersQuery.isLoading && assignableUsers.length === 0 ? <Text style={styles.emptyText}>No available users to assign.</Text> : null}
                {assignableUsers.map((member) => (
                  <Pressable key={member.id} style={styles.modalRow} disabled={assignMutation.isPending} onPress={() => { setAssignPickerVisible(false); assignMutation.mutate(member.id) }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalRowTitle}>{member.firstName} {member.lastName}</Text>
                      <Text style={styles.modalRowMeta}>{member.role}</Text>
                    </View>
                    <Ionicons name="person-add-outline" size={18} color={colors.brandPrimary} />
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable style={styles.modalCloseButton} onPress={() => setAssignPickerVisible(false)}><Text style={styles.modalCloseText}>Close</Text></Pressable>
            </View>
          </View>
        </Modal>
      </ScrollView>

      <AttachmentPickerSheet visible={attachmentPickerVisible} onClose={() => setAttachmentPickerVisible(false)} onSelect={onSelectAttachment} />
    </AppScreen>
  )
}

// ---- reusable presentational pieces ----
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

function FinCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.finCell}>
      <Text style={styles.finLabel}>{label}</Text>
      <Text style={styles.finValue}>{value}</Text>
    </View>
  )
}
function Chip({ label, count }: { label: string; count: number }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.chipCount}><Text style={styles.chipCountText}>{count}</Text></View>
    </View>
  )
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  loadingText: { ...typography.sub, color: colors.textSecondary },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md },
  retryText: { color: '#fff', fontWeight: '700' },

  overview: { paddingHorizontal: spacing.xs, paddingTop: spacing.xs, gap: 6 },
  jobNumber: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addrText: { ...typography.sub, color: colors.textSecondary },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800' },
  countPill: { backgroundColor: '#EEF2F7', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2, minWidth: 28, alignItems: 'center' },
  countPillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '800' },
  cardCollapsed: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm, gap: spacing.sm },
  quickAction: { flexGrow: 1, flexBasis: '22%', minWidth: 72, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F1F5F9', borderRadius: radius.md, paddingVertical: spacing.sm },
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

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F1F5F9', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  chipLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chipCount: { backgroundColor: '#E2E8F0', borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  chipCountText: { ...typography.caption, color: colors.textPrimary, fontWeight: '800', fontSize: 11 },
  emptyHint: { ...typography.caption, color: colors.muted },

  statusSelectTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  statusSelectValue: { ...typography.sub, color: colors.textPrimary, fontWeight: '700' },
  assignButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assignButtonText: { ...typography.caption, color: colors.brandPrimary, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  modalTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', marginBottom: spacing.sm },
  modalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  modalRowActive: { backgroundColor: 'rgba(0,0,0,0.04)' },
  modalRowTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '600' },
  modalRowMeta: { ...typography.caption, color: colors.textSecondary },
  modalCloseButton: { marginTop: spacing.sm, alignItems: 'center', paddingVertical: spacing.sm },
  modalCloseText: { ...typography.sub, color: colors.textSecondary, fontWeight: '700' },
  emptyText: { ...typography.caption, color: colors.textSecondary, padding: spacing.sm },
})
