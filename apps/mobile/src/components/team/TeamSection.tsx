import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { apiRequest } from '../../api/client'
import { DetailSection } from '../DetailSection'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { ASSIGNMENT_ROLES, type AssignmentRole, type TeamEntry, type TeamMember } from '../../lib/team'

type PickerUser = { id: string; firstName: string; lastName: string; role?: string | null }
const nameOf = (u: PickerUser) => `${u.firstName} ${u.lastName}`.trim()

/**
 * The team on a job / task / issue, grouped as Site Managers, Office Workers and
 * Field Workers. People who can assign get an Edit button that opens a sheet to
 * add or remove people in each group.
 */
export function TeamSection({
  title = 'Team',
  team,
  canEdit,
  onSave,
}: {
  title?: string
  team: TeamMember[]
  canEdit: boolean
  onSave: (entries: TeamEntry[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <DetailSection
        title={title}
        right={
          canEdit ? (
            <Pressable onPress={() => setOpen(true)} hitSlop={8} style={styles.editBtn}>
              <Ionicons name="create-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          ) : undefined
        }
      >
        {team.length === 0 ? <Text style={styles.empty}>No one assigned</Text> : null}
        {ASSIGNMENT_ROLES.map((role) => {
          const members = team.filter((m) => m.role === role.value)
          if (members.length === 0) return null
          return (
            <View key={role.value} style={styles.group}>
              <Text style={styles.groupTitle}>{role.label}</Text>
              <View style={styles.chips}>
                {members.map((m) => (
                  <View key={m.userId} style={styles.chip}>
                    <Text style={styles.chipText}>{m.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )
        })}
      </DetailSection>
      <TeamEditSheet open={open} onClose={() => setOpen(false)} team={team} onSave={onSave} />
    </>
  )
}

function TeamEditSheet({
  open,
  onClose,
  team,
  onSave,
}: {
  open: boolean
  onClose: () => void
  team: TeamMember[]
  onSave: (entries: TeamEntry[]) => Promise<void>
}) {
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState<TeamEntry[]>([])
  const [adding, setAdding] = useState<AssignmentRole | null>(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['assignable-users'],
    queryFn: () => apiRequest<{ users: PickerUser[] }>('/api/assignments/users'),
    enabled: open,
    staleTime: 5 * 60_000,
  })
  const users = usersQuery.data?.users ?? []
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  useEffect(() => {
    if (!open) return
    setDraft(team.map((m) => ({ userId: m.userId, role: m.role })))
    setAdding(null)
    setSearch('')
    setError(null)
  }, [open, team])

  const taken = new Set(draft.map((d) => d.userId))
  const term = search.trim().toLowerCase()
  const available = users.filter((u) => !taken.has(u.id) && (!term || nameOf(u).toLowerCase().includes(term)))
  const nameFor = (userId: string) => {
    const u = byId.get(userId)
    return u ? nameOf(u) : team.find((m) => m.userId === userId)?.name || 'Unknown'
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Could not save the team. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl) }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Edit team</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            style={{ maxHeight: Dimensions.get('window').height * 0.62 }}
            contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
            keyboardShouldPersistTaps="handled"
          >
            {ASSIGNMENT_ROLES.map((role) => {
              const members = draft.filter((d) => d.role === role.value)
              const isAdding = adding === role.value
              return (
                <View key={role.value} style={styles.roleCard}>
                  <View style={styles.roleHead}>
                    <Text style={styles.groupTitle}>{role.label}</Text>
                    <Pressable
                      onPress={() => {
                        setAdding(isAdding ? null : role.value)
                        setSearch('')
                      }}
                      hitSlop={6}
                      style={styles.addBtn}
                    >
                      <Ionicons name={isAdding ? 'chevron-up' : 'add'} size={16} color={colors.brandPrimary} />
                      <Text style={styles.editBtnText}>{isAdding ? 'Done' : 'Add'}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.chips}>
                    {members.length === 0 ? <Text style={styles.empty}>No one yet</Text> : null}
                    {members.map((m) => (
                      <View key={m.userId} style={[styles.chip, styles.chipRow]}>
                        <Text style={styles.chipText}>{nameFor(m.userId)}</Text>
                        <Pressable
                          onPress={() => setDraft((prev) => prev.filter((d) => d.userId !== m.userId))}
                          hitSlop={8}
                        >
                          <Ionicons name="close-circle" size={18} color={colors.muted} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                  {isAdding ? (
                    <View style={styles.picker}>
                      <TextInput
                        style={styles.search}
                        placeholder="Search people…"
                        placeholderTextColor={colors.muted}
                        value={search}
                        onChangeText={setSearch}
                      />
                      {usersQuery.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
                      {!usersQuery.isLoading && available.length === 0 ? (
                        <Text style={styles.empty}>No one else to add</Text>
                      ) : null}
                      <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                        {available.map((u) => (
                          <Pressable
                            key={u.id}
                            style={styles.pickRow}
                            onPress={() => setDraft((prev) => [...prev, { userId: u.id, role: role.value }])}
                          >
                            <Text style={styles.pickText}>{nameOf(u)}</Text>
                            <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>
              )
            })}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.footer}>
            <Pressable onPress={onClose} style={styles.cancel} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} style={[styles.save, saving && { opacity: 0.6 }]} disabled={saving}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save team'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBtnText: { ...typography.caption, color: colors.brandPrimary, fontWeight: '700' },
  empty: { ...typography.caption, color: colors.muted },
  group: { marginBottom: spacing.sm },
  groupTitle: { ...typography.sub, color: colors.textSecondary, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { backgroundColor: '#EEF2F6', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 },
  chipText: { ...typography.sub, color: colors.textPrimary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sheetTitle: { ...typography.h2, color: colors.textPrimary },
  roleCard: { borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, padding: spacing.sm },
  roleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  picker: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm, gap: 6 },
  search: { borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8, color: colors.textPrimary },
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  pickText: { ...typography.sub, color: colors.textPrimary },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  cancel: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md },
  cancelText: { ...typography.sub, color: colors.textSecondary, fontWeight: '700' },
  save: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { ...typography.sub, color: colors.surface, fontWeight: '700' },
})
