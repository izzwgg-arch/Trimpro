import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { EmptyState } from '../EmptyState'
import { colors, radius, spacing, typography } from '../../theme/tokens'

// ---- types mirroring GET /api/production/pipelines (lib/production/pipeline-data.ts) ----
export type PipelineItemType = 'JOB' | 'ESTIMATE' | 'INVOICE'
export interface PipelineItem {
  type: PipelineItemType
  id: string
  number: string
  title: string
  status: string
  stage: string
  stageLabel: string
  stageColor: string
  daysInStage: number | null
  enteredAt: string | null
  date: string | null
  closed: boolean
  client: { id: string; name: string } | null
  jobSiteAddress: string | null
  amount: number
  paidAmount: number | null
  balance: number | null
  dueDate: string | null
  responsible: { id: string; name: string; isDefault: boolean } | null
  nextAction: string | null
  nextActionIsDefault: boolean
  followUpDate: string | null
  followUpOverdue: boolean
  hold: { onHold: boolean; reason: string | null; heldAt: string | null; releasedAt: string | null }
  notes: string | null
  reviewStage: string | null
  disputed: boolean
  ignoredManual: string | null
  allowed: { hold: boolean; review: boolean; dispute: boolean; edit: boolean }
  related: {
    job: { id: string; jobNumber: string; title: string } | null
    estimate: { id: string; estimateNumber: string } | null
    invoices: Array<{ id: string; invoiceNumber: string; status: string }>
    estimates: Array<{ id: string; estimateNumber: string; status: string }>
  }
}
export interface PipelineStage { id: string; label: string; color: string; icon: string; order: number; visible: boolean; defaultNextAction: string }
export interface PipelineConfig {
  estimates: { stages: PipelineStage[] }
  invoices: { stages: PipelineStage[] }
  holdReasons: string[]
  holdFollowUpDays: number
}
export interface PipelineResponse { items: PipelineItem[]; config: PipelineConfig }
type Person = { id: string; firstName: string; lastName: string }

const SCREEN_H = Dimensions.get('window').height

export function money(v: number | null | undefined): string {
  const n = Number(v || 0)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
export function shortDate(v: string | null): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const statusWord = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
const daysLabel = (d: number | null) => (d === null ? '' : d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`)
const TYPE_META: Record<PipelineItemType, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  JOB: { label: 'Job', color: '#475569', icon: 'briefcase-outline' },
  ESTIMATE: { label: 'Estimate', color: '#7c3aed', icon: 'document-text-outline' },
  INVOICE: { label: 'Invoice', color: '#059669', icon: 'receipt-outline' },
}

export function TypeBadge({ type }: { type: PipelineItemType }) {
  const m = TYPE_META[type]
  return (
    <View style={[styles.typeBadge, { borderColor: m.color }]}>
      <Ionicons name={m.icon} size={11} color={m.color} />
      <Text style={[styles.typeBadgeText, { color: m.color }]}>{m.label}</Text>
    </View>
  )
}

/** Card on the mobile Estimates / Invoices boards (same look as the jobs board cards). */
export function PipelineCard({ item, onPress }: { item: PipelineItem; onPress: () => void }) {
  const isInvoice = item.type === 'INVOICE'
  const overdue = isInvoice && item.stage === 'OVERDUE'
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { borderLeftColor: item.stageColor }, pressed && { opacity: 0.92 }]}>
      <View style={styles.rowBetween}>
        <Text style={styles.number}>{item.number}</Text>
        <View style={styles.statusPill}><Text style={styles.statusPillText}>{statusWord(item.status)}</Text></View>
      </View>
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      {item.client ? <Text style={styles.meta} numberOfLines={1}>{item.client.name}</Text> : null}
      {item.hold.onHold ? (
        <View style={styles.holdBanner}>
          <Ionicons name="pause-circle-outline" size={13} color="#9a3412" />
          <Text style={styles.holdText} numberOfLines={2}>On hold{item.hold.reason ? `: ${item.hold.reason}` : ''}</Text>
        </View>
      ) : null}
      <View style={styles.rowBetween}>
        <Text style={styles.amount}>{money(item.amount)}</Text>
        {isInvoice && item.balance ? <Text style={[styles.meta, overdue && styles.danger]}>Balance {money(item.balance)}</Text> : null}
      </View>
      <Line icon="person-outline" text={item.responsible?.name || 'Unassigned'} />
      {item.jobSiteAddress ? <Line icon="location-outline" text={item.jobSiteAddress} /> : null}
      {isInvoice && item.date ? <Line icon="calendar-outline" text={`Invoice date ${shortDate(item.date)}`} /> : null}
      {isInvoice && item.dueDate ? <Line icon="calendar-outline" text={`Due ${shortDate(item.dueDate)}`} danger={overdue} /> : null}
      {item.nextAction ? <Text style={styles.meta} numberOfLines={2}><Text style={styles.bold}>Next: </Text>{item.nextAction}</Text> : null}
      {item.followUpDate ? (
        <Line icon={item.followUpOverdue ? 'warning-outline' : 'alarm-outline'} text={`Follow up ${shortDate(item.followUpDate)}`} danger={item.followUpOverdue} />
      ) : null}
      {item.daysInStage !== null ? (
        <Text style={styles.faint}>In stage {daysLabel(item.daysInStage)}{item.enteredAt ? ` · since ${shortDate(item.enteredAt)}` : ''}</Text>
      ) : null}
      {item.related.job ? <Text style={styles.related}>Job {item.related.job.jobNumber}</Text> : null}
    </Pressable>
  )
}

function Line({ icon, text, danger }: { icon: keyof typeof Ionicons.glyphMap; text: string; danger?: boolean }) {
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={12} color={danger ? colors.danger : colors.muted} />
      <Text style={[styles.meta, { flex: 1 }, danger && styles.danger]} numberOfLines={1}>{text}</Text>
    </View>
  )
}

/** All Work overview: jobs, estimates and invoices in one list, most urgent first. */
export function AllWorkList({
  items,
  refreshing,
  onRefresh,
  onPress,
}: {
  items: PipelineItem[]
  refreshing: boolean
  onRefresh: () => void
  onPress: (item: PipelineItem) => void
}) {
  const [type, setType] = useState<'all' | PipelineItemType>('all')
  const [only, setOnly] = useState<'all' | 'held' | 'followUp'>('all')
  const rows = useMemo(
    () =>
      items
        .filter((i) => (type === 'all' || i.type === type) && (only === 'all' || (only === 'held' ? i.hold.onHold : i.followUpOverdue)))
        .sort((a, b) => Number(b.followUpOverdue) - Number(a.followUpOverdue) || Number(b.hold.onHold) - Number(a.hold.onHold) || (b.daysInStage ?? 0) - (a.daysInStage ?? 0)),
    [items, type, only]
  )
  const chip = (active: boolean, label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
  return (
    <FlatList
      data={rows}
      keyExtractor={(i) => `${i.type}-${i.id}`}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {chip(type === 'all', 'All', () => setType('all'))}
          {chip(type === 'JOB', 'Jobs', () => setType('JOB'))}
          {chip(type === 'ESTIMATE', 'Estimates', () => setType('ESTIMATE'))}
          {chip(type === 'INVOICE', 'Invoices', () => setType('INVOICE'))}
          {chip(only === 'held', 'On hold', () => setOnly(only === 'held' ? 'all' : 'held'))}
          {chip(only === 'followUp', 'Past-due follow-up', () => setOnly(only === 'followUp' ? 'all' : 'followUp'))}
        </ScrollView>
      }
      ListEmptyComponent={<EmptyState icon="file-tray-outline" title="Nothing here" description="Nothing matches these filters." />}
      renderItem={({ item }) => (
        <Pressable onPress={() => onPress(item)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}>
          <View style={styles.rowBetween}>
            <View style={styles.rowLeft}>
              <TypeBadge type={item.type} />
              <Text style={styles.number}>{item.number}</Text>
            </View>
            <View style={[styles.stagePill, { backgroundColor: item.stageColor }]}><Text style={styles.stagePillText}>{item.stageLabel}</Text></View>
          </View>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{[item.client?.name, item.jobSiteAddress].filter(Boolean).join(' · ') || '—'}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.responsible?.name || 'Unassigned'}
            {item.daysInStage !== null ? ` · in stage ${daysLabel(item.daysInStage)}` : ''}
            {item.type === 'INVOICE' && item.balance ? ` · ${money(item.balance)} due` : ''}
          </Text>
          {item.hold.onHold ? <Text style={styles.holdInline}>On hold{item.hold.reason ? `: ${item.hold.reason}` : ''}</Text> : null}
          {relatedText(item) ? <Text style={styles.related} numberOfLines={1}>{relatedText(item)}</Text> : null}
          {item.nextAction ? <Text style={[styles.meta, item.followUpOverdue && styles.danger]} numberOfLines={1}>Next: {item.nextAction}{item.followUpDate ? ` · ${shortDate(item.followUpDate)}` : ''}</Text> : null}
        </Pressable>
      )}
    />
  )
}

/** "EST-1 → JOB-2 → INV-3, INV-4": the linked records that really exist. */
function relatedText(item: PipelineItem): string {
  const parts = [
    ...(item.related.estimate ? [item.related.estimate.estimateNumber] : []),
    ...item.related.estimates.map((e) => e.estimateNumber),
    ...(item.related.job ? [item.related.job.jobNumber] : []),
    ...item.related.invoices.map((i) => i.invoiceNumber),
  ]
  return parts.join(' · ')
}

const toDay = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
const dayToDate = (d: string) => (d ? new Date(`${d}T12:00:00`) : new Date())
const dateToDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Details + hold / next action for one estimate or invoice. Drawn over the screen
 * (not a Modal) so the keyboard-aware scroll keeps the text boxes above the keyboard.
 */
export function PipelineSheet({
  item,
  config,
  people,
  onClose,
  onSave,
  onOpenJob,
}: {
  item: PipelineItem | null
  config: PipelineConfig | undefined
  people: Person[]
  onClose: () => void
  onSave: (item: PipelineItem, changes: Record<string, unknown>) => Promise<void>
  onOpenJob: (jobId: string) => void
}) {
  const insets = useSafeAreaInsets()
  const [onHold, setOnHold] = useState(false)
  const [reason, setReason] = useState('')
  const [review, setReview] = useState('')
  const [disputed, setDisputed] = useState(false)
  const [responsibleId, setResponsibleId] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [showIosDate, setShowIosDate] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!item) return
    setOnHold(item.hold.onHold)
    setReason(item.hold.reason || '')
    setReview(item.reviewStage || '')
    setDisputed(item.disputed)
    setResponsibleId(item.responsible && !item.responsible.isDefault ? item.responsible.id : '')
    setNextAction(item.nextActionIsDefault ? '' : item.nextAction || '')
    setFollowUp(toDay(item.followUpDate))
    setNotes(item.notes || '')
    setError(null)
    setShowIosDate(false)
  }, [item])

  useEffect(() => {
    if (!item) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => sub.remove()
  }, [item, onClose])

  if (!item || item.type === 'JOB') return null
  const board = item.type === 'ESTIMATE' ? 'estimates' : 'invoices'
  const stages = config?.[board].stages || []
  const labelFor = (id: string) => stages.find((s) => s.id === id)?.label || statusWord(id)
  const defaultNext = stages.find((s) => s.id === item.stage)?.defaultNextAction
  const canEdit = item.allowed.edit

  const toggleHold = (v: boolean) => {
    setOnHold(v)
    if (v && !followUp && (config?.holdFollowUpDays ?? 0) > 0) {
      const d = new Date()
      d.setDate(d.getDate() + (config?.holdFollowUpDays ?? 0))
      setFollowUp(dateToDay(d))
    }
  }
  const pickDate = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: dayToDate(followUp), mode: 'date', onChange: (_e, d) => d && setFollowUp(dateToDay(d)) })
    } else {
      setShowIosDate((v) => !v)
    }
  }

  const save = async () => {
    if (onHold && !reason.trim()) return setError('Pick or type a hold reason.')
    const changes: Record<string, unknown> = {
      responsibleUserId: responsibleId || null,
      nextAction: nextAction.trim() || null,
      followUpDate: followUp || null,
      notes,
    }
    if (item.allowed.hold || item.hold.onHold) {
      changes.onHold = onHold
      if (onHold) changes.holdReason = reason.trim()
    }
    if (item.allowed.review || item.reviewStage) changes.reviewStage = item.allowed.review ? review || null : null
    if (item.allowed.dispute || item.disputed) changes.disputed = item.allowed.dispute ? disputed : false
    setSaving(true)
    setError(null)
    try {
      await onSave(item, changes)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const chip = (active: boolean, label: string, onPress: () => void, key?: string) => (
    <Pressable key={key || label} onPress={onPress} disabled={!canEdit} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { maxHeight: SCREEN_H * 0.88, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <View style={styles.sheetHeader}>
          <View style={styles.rowLeft}>
            <TypeBadge type={item.type} />
            <Text style={styles.sheetTitle}>{item.number}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable>
        </View>
        <KeyboardAwareScrollView contentContainerStyle={styles.sheetBody} bottomOffset={spacing.lg} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{item.title}</Text>
          {item.client ? <Text style={styles.meta}>{item.client.name}</Text> : null}
          <View style={styles.rowLeft}>
            <View style={[styles.stagePill, { backgroundColor: item.stageColor }]}><Text style={styles.stagePillText}>{item.stageLabel}</Text></View>
            <Text style={styles.meta}>Status: {statusWord(item.status)}</Text>
          </View>
          <Text style={styles.faint}>
            The stage follows the {item.type === 'ESTIMATE' ? "estimate's status" : "invoice's status and payments"}.
          </Text>
          {item.ignoredManual ? (
            <Text style={styles.warn}>&quot;{labelFor(item.ignoredManual)}&quot; no longer applies — it is now {statusWord(item.status).toLowerCase()}.</Text>
          ) : null}
          <View style={styles.rowBetween}>
            <Text style={styles.amount}>{money(item.amount)}</Text>
            {item.type === 'INVOICE' && item.balance ? <Text style={styles.meta}>Paid {money(item.paidAmount)} · Balance {money(item.balance)}</Text> : null}
          </View>
          {item.jobSiteAddress ? <Line icon="location-outline" text={item.jobSiteAddress} /> : null}
          {item.related.job ? (
            <Pressable style={styles.linkRow} onPress={() => onOpenJob(item.related.job!.id)}>
              <Ionicons name="briefcase-outline" size={15} color={colors.brandPrimary} />
              <Text style={styles.linkText}>Job {item.related.job.jobNumber} · {item.related.job.title}</Text>
              <Ionicons name="chevron-forward" size={15} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
          {item.related.estimate ? <Text style={styles.meta}>From estimate {item.related.estimate.estimateNumber}</Text> : null}
          {item.related.invoices.length ? (
            <Text style={styles.meta}>Invoices: {item.related.invoices.map((i) => `${i.invoiceNumber} (${statusWord(i.status)})`).join(', ')}</Text>
          ) : null}

          {!canEdit ? <Text style={styles.warn}>You can view this, but changing it needs edit permission.</Text> : null}

          {item.allowed.review ? (
            <>
              <Text style={styles.label}>Draft step</Text>
              <View style={styles.chipWrap}>
                {chip(review === '', labelFor('DRAFT'), () => setReview(''), 'd')}
                {chip(review === 'INTERNAL_REVIEW', labelFor('INTERNAL_REVIEW'), () => setReview('INTERNAL_REVIEW'), 'ir')}
                {chip(review === 'READY_TO_SEND', labelFor('READY_TO_SEND'), () => setReview('READY_TO_SEND'), 'rs')}
              </View>
            </>
          ) : null}

          {item.allowed.hold || item.hold.onHold ? (
            <View style={styles.box}>
              <View style={styles.rowBetween}>
                <Text style={styles.bold}>On hold</Text>
                <Switch value={onHold} onValueChange={toggleHold} disabled={!canEdit} />
              </View>
              {onHold ? (
                <>
                  <View style={styles.chipWrap}>
                    {(config?.holdReasons || []).map((r) => chip(reason === r, r, () => setReason(r), r))}
                  </View>
                  <TextInput
                    style={styles.input}
                    value={reason}
                    onChangeText={setReason}
                    editable={canEdit}
                    placeholder="Or type a reason"
                    placeholderTextColor={colors.muted}
                  />
                </>
              ) : null}
              {item.hold.heldAt ? <Text style={styles.faint}>Placed on hold {shortDate(item.hold.heldAt)}</Text> : null}
              {!item.hold.onHold && item.hold.releasedAt ? <Text style={styles.faint}>Released {shortDate(item.hold.releasedAt)}</Text> : null}
            </View>
          ) : null}

          {item.allowed.dispute || item.disputed ? (
            <View style={styles.rowBetween}>
              <Text style={styles.bold}>Disputed by the client</Text>
              <Switch value={disputed} onValueChange={setDisputed} disabled={!canEdit || !item.allowed.dispute} />
            </View>
          ) : null}

          <Text style={styles.label}>Responsible</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowTight} keyboardShouldPersistTaps="handled">
            {chip(responsibleId === '', item.responsible?.isDefault ? `Default · ${item.responsible.name}` : 'Nobody', () => setResponsibleId(''), 'none')}
            {people.map((p) => chip(responsibleId === p.id, `${p.firstName} ${p.lastName}`.trim(), () => setResponsibleId(p.id), p.id))}
          </ScrollView>

          <Text style={styles.label}>Next action</Text>
          <TextInput
            style={styles.input}
            value={nextAction}
            onChangeText={setNextAction}
            editable={canEdit}
            placeholder={defaultNext || 'What happens next?'}
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>Follow-up date</Text>
          <View style={styles.rowLeft}>
            <Pressable style={[styles.input, styles.dateButton]} onPress={pickDate} disabled={!canEdit}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={followUp ? styles.dateValue : styles.datePlaceholder}>{followUp ? shortDate(`${followUp}T12:00:00`) : 'Pick a date'}</Text>
            </Pressable>
            {followUp && canEdit ? (
              <Pressable onPress={() => setFollowUp('')} hitSlop={8}><Ionicons name="close-circle" size={20} color={colors.muted} /></Pressable>
            ) : null}
          </View>
          {Platform.OS === 'ios' && showIosDate ? (
            <DateTimePicker value={dayToDate(followUp)} mode="date" display="inline" onChange={(_e, d) => d && setFollowUp(dateToDay(d))} />
          ) : null}

          <Text style={styles.label}>Internal notes</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={notes}
            onChangeText={setNotes}
            editable={canEdit}
            multiline
            placeholder="Notes for the team"
            placeholderTextColor={colors.muted}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {canEdit ? (
            <Pressable style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.saveText}>Save</Text>}
            </Pressable>
          ) : null}
        </KeyboardAwareScrollView>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    borderLeftWidth: 4,
    padding: 12,
    gap: 3,
  },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, padding: 12, gap: 3 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  number: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary, fontVariant: ['tabular-nums'] },
  title: { ...typography.sub, color: colors.textPrimary, fontWeight: '700' },
  meta: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
  faint: { ...typography.caption, color: colors.muted, fontSize: 11 },
  bold: { fontWeight: '700', color: colors.textPrimary },
  amount: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  danger: { color: colors.danger, fontWeight: '700' },
  related: { fontSize: 11, fontWeight: '700', color: colors.brandPrimary, marginTop: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusPill: { borderRadius: radius.pill, backgroundColor: '#F2F4F7', paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  stagePill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  stagePillText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  holdBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, backgroundColor: '#FFF7ED', borderRadius: 6, padding: 6, marginVertical: 2 },
  holdText: { fontSize: 11, color: '#9a3412', flex: 1 },
  holdInline: { fontSize: 12, color: '#9a3412', fontWeight: '600' },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  typeBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  listContent: { padding: spacing.md, gap: spacing.xs, paddingBottom: spacing.xl },
  chipRow: { gap: 6, paddingBottom: spacing.xs },
  chipRowTight: { gap: 6, paddingVertical: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.surface },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  sheetBody: { padding: spacing.md, gap: spacing.xs, paddingBottom: spacing.xl },
  warn: { fontSize: 12, color: '#92400e', backgroundColor: '#FFFBEB', borderRadius: 6, padding: 6 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  linkText: { flex: 1, color: colors.brandPrimary, fontWeight: '700', fontSize: 13 },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing.xs },
  box: { borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs, marginTop: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  dateButton: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dateValue: { color: colors.textPrimary, fontSize: 14 },
  datePlaceholder: { color: colors.muted, fontSize: 14 },
  errorText: { color: colors.danger, fontWeight: '600' },
  saveButton: { marginTop: spacing.sm, minHeight: 50, borderRadius: radius.sm, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: colors.surface, fontSize: 16, fontWeight: '700' },
})
