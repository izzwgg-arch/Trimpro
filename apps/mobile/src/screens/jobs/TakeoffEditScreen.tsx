import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { ComboField } from '../../components/takeoffs/ComboField'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { JobsStackParamList } from '../../types/navigation'
import {
  activeValues,
  DOOR_FIELDS,
  type DoorFieldKey,
  type TakeoffConfig,
  type TakeoffResponse,
} from '../../lib/takeoffs'

type Props = NativeStackScreenProps<JobsStackParamList, 'TakeoffEdit'>

type Door = { key: string; location: string; notes: string } & Record<DoorFieldKey, string>
type Item = { key: string; category: string; quantity: string; unit: string; description: string; notes: string }

let seq = 0
const newKey = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`
const emptyDoor = (): Door => ({
  key: newKey(),
  location: '',
  notes: '',
  height: '',
  width: '',
  swing: '',
  lock: '',
  jamb: '',
  hinge: '',
  doorStyle: '',
})
const doorHasData = (d: Door) => Boolean(d.location || d.notes || DOOR_FIELDS.some((f) => d[f.key]))
const itemHasData = (i: Item) => Boolean(i.quantity || i.unit || i.description || i.notes)
const formatWhen = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '')

export function TakeoffEditScreen({ route, navigation }: Props) {
  const { takeoffId } = route.params
  const queryClient = useQueryClient()
  const { canEditTakeoffs, canDeleteTakeoffs } = useMobilePermissions()
  const canEdit = canEditTakeoffs()
  const ro = !canEdit

  const takeoffQuery = useQuery({
    queryKey: ['takeoff', takeoffId],
    queryFn: () => apiRequest<TakeoffResponse>(`/api/takeoffs/${takeoffId}`),
  })
  const configQuery = useQuery({
    queryKey: ['takeoff-settings'],
    queryFn: () => apiRequest<{ config: TakeoffConfig }>('/api/takeoffs/settings'),
    staleTime: 5 * 60_000,
  })
  const config = configQuery.data?.config

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [doors, setDoors] = useState<Door[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [openDoor, setOpenDoor] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const initialized = useRef(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  const applyTakeoff = useCallback((t: TakeoffResponse['takeoff']) => {
    setTitle(t.title || '')
    setNotes(t.notes || '')
    setDoors(t.doors.map((d) => ({ ...emptyDoor(), ...d, key: d.id || newKey() })))
    setItems(
      t.items.map((i) => ({
        key: i.id || newKey(),
        category: i.category,
        quantity: i.quantity === null || i.quantity === undefined ? '' : String(i.quantity),
        unit: i.unit || '',
        description: i.description || '',
        notes: i.notes || '',
      }))
    )
    setUpdatedAt(t.updatedAt)
    setDirty(false)
  }, [])

  useEffect(() => {
    if (!takeoffQuery.data?.takeoff || initialized.current) return
    initialized.current = true
    applyTakeoff(takeoffQuery.data.takeoff)
  }, [applyTakeoff, takeoffQuery.data])

  // Ask before leaving with unsaved changes.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      Alert.alert('Unsaved changes', 'Leave without saving? Your changes will be lost.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ])
    })
    return unsubscribe
  }, [navigation])

  const touch = () => setDirty(true)
  const updateDoor = (key: string, field: keyof Door, value: string) => {
    setDoors((prev) => prev.map((d) => (d.key === key ? { ...d, [field]: value } : d)))
    touch()
  }
  const addDoors = (n: number) => {
    const added = Array.from({ length: n }, emptyDoor)
    setDoors((prev) => [...prev, ...added])
    setOpenDoor(added[0].key)
    touch()
  }
  const removeDoor = (door: Door, index: number) => {
    const doRemove = () => {
      setDoors((prev) => prev.filter((d) => d.key !== door.key))
      touch()
    }
    if (!doorHasData(door)) return doRemove()
    Alert.alert(`Remove door #${index + 1}?`, 'Its details will be lost when you save.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: doRemove },
    ])
  }
  const updateItem = (key: string, field: keyof Item, value: string) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)))
    touch()
  }
  const addItem = (category: string) => {
    setItems((prev) => [...prev, { key: newKey(), category, quantity: '', unit: '', description: '', notes: '' }])
    touch()
  }
  const removeItem = (item: Item) => {
    const doRemove = () => {
      setItems((prev) => prev.filter((i) => i.key !== item.key))
      touch()
    }
    if (!itemHasData(item)) return doRemove()
    Alert.alert('Remove this material?', 'It will be lost when you save.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: doRemove },
    ])
  }

  const categories = useMemo(() => {
    const list = (config?.categories || []).filter((c) => c.active || items.some((i) => i.category === c.key))
    const known = new Set((config?.categories || []).map((c) => c.key))
    const orphans = Array.from(new Set(items.map((i) => i.category).filter((k) => !known.has(k))))
    return [...list, ...orphans.map((k) => ({ key: k, label: k, active: false, options: [] }))]
  }, [config, items])

  const save = async () => {
    setSaving(true)
    try {
      const res = await apiRequest<TakeoffResponse>(`/api/takeoffs/${takeoffId}`, 'PUT', {
        expectedUpdatedAt: updatedAt,
        title,
        notes,
        doors: doors.map(({ key, ...d }) => d),
        items: items.map(({ key, ...i }) => i),
      })
      applyTakeoff(res.takeoff)
      queryClient.setQueryData(['takeoff', takeoffId], res)
      queryClient.invalidateQueries({ queryKey: ['job-takeoffs'] })
      Alert.alert('Saved', 'Takeoff saved.')
    } catch (error: any) {
      Alert.alert('Could not save', error?.message || 'Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const deleteTakeoff = () => {
    Alert.alert('Delete takeoff?', 'All doors and materials on it will be deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest(`/api/takeoffs/${takeoffId}`, 'DELETE')
            setDirty(false)
            dirtyRef.current = false
            queryClient.invalidateQueries({ queryKey: ['job-takeoffs'] })
            navigation.goBack()
          } catch (error: any) {
            Alert.alert('Could not delete', error?.message || 'Try again.')
          }
        },
      },
    ])
  }

  if (takeoffQuery.isError) {
    return (
      <AppScreen>
        <Text style={styles.error}>{(takeoffQuery.error as any)?.message || 'Could not load this takeoff.'}</Text>
      </AppScreen>
    )
  }
  if (!takeoffQuery.data?.takeoff || !initialized.current) {
    return (
      <AppScreen>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} />
      </AppScreen>
    )
  }
  const t = takeoffQuery.data.takeoff
  const fieldOptions = (k: DoorFieldKey) => activeValues(config?.doorFields?.[k])

  return (
    <AppScreen padded={false}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Info label="Customer" value={t.job?.customer} />
          <Info label="Job" value={t.job ? `${t.job.jobNumber} — ${t.job.title}` : ''} />
          <Info label="Job site" value={t.job?.siteAddress} />
          <Info label="Created" value={`${formatWhen(t.createdAt)}${t.createdBy?.name ? ` · ${t.createdBy.name}` : ''}`} />
          <Info label="Last updated" value={`${formatWhen(t.updatedAt)}${t.updatedBy?.name ? ` · ${t.updatedBy.name}` : ''}`} />
          <Text style={styles.fieldLabel}>Name (optional)</Text>
          <TextInput style={styles.input} value={title} editable={!ro} placeholder="e.g. First floor" placeholderTextColor={colors.muted} onChangeText={(v) => { setTitle(v); touch() }} />
          <Text style={styles.fieldLabel}>Notes</Text>
          <TextInput style={[styles.input, styles.multiline]} value={notes} editable={!ro} multiline onChangeText={(v) => { setNotes(v); touch() }} />
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Door Schedule ({doors.length})</Text>
        </View>
        {doors.length === 0 ? <Text style={styles.empty}>No doors yet.</Text> : null}
        {doors.map((d, i) => {
          const open = openDoor === d.key
          const summary = [d.location, [d.width, d.height].filter(Boolean).join(' x '), d.swing, d.lock].filter(Boolean).join(' · ')
          return (
            <View key={d.key} style={styles.card}>
              <Pressable style={styles.doorHead} onPress={() => setOpenDoor(open ? null : d.key)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.doorTitle}>Door #{i + 1}</Text>
                  {!open && summary ? (
                    <Text style={styles.doorSummary} numberOfLines={1}>
                      {summary}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textSecondary} />
              </Pressable>
              {open ? (
                <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                  <View>
                    <Text style={styles.fieldLabel}>Location / Notes</Text>
                    <TextInput style={styles.input} value={d.location} editable={!ro} onChangeText={(v) => updateDoor(d.key, 'location', v)} />
                  </View>
                  <View style={styles.grid}>
                    {DOOR_FIELDS.map((f) => (
                      <View key={f.key} style={styles.gridCell}>
                        <ComboField label={f.label} value={d[f.key]} options={fieldOptions(f.key)} disabled={ro} onChange={(v) => updateDoor(d.key, f.key, v)} />
                      </View>
                    ))}
                  </View>
                  <View>
                    <Text style={styles.fieldLabel}>Additional Notes</Text>
                    <TextInput style={styles.input} value={d.notes} editable={!ro} onChangeText={(v) => updateDoor(d.key, 'notes', v)} />
                  </View>
                  {!ro ? (
                    <Pressable style={styles.removeBtn} onPress={() => removeDoor(d, i)}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      <Text style={styles.removeText}>Remove Door</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          )
        })}
        {!ro ? (
          <View style={styles.row}>
            <Pressable style={styles.addBtn} onPress={() => addDoors(1)}>
              <Ionicons name="add" size={20} color={colors.brandPrimary} />
              <Text style={styles.addText}>Add Door</Text>
            </Pressable>
            <Pressable style={styles.addBtn} onPress={() => addDoors(10)}>
              <Ionicons name="add" size={20} color={colors.brandPrimary} />
              <Text style={styles.addText}>Add 10 Doors</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Other Materials</Text>
        </View>
        {categories.map((c) => {
          const rows = items.filter((i) => i.category === c.key)
          return (
            <View key={c.key} style={styles.card}>
              <View style={styles.catHead}>
                <Text style={styles.catTitle}>{c.label}</Text>
                {!ro ? (
                  <Pressable style={styles.smallAdd} onPress={() => addItem(c.key)}>
                    <Ionicons name="add" size={18} color={colors.brandPrimary} />
                    <Text style={styles.addText}>Add Material</Text>
                  </Pressable>
                ) : null}
              </View>
              {rows.length === 0 ? <Text style={styles.empty}>None</Text> : null}
              {rows.map((it) => (
                <View key={it.key} style={styles.itemBox}>
                  <View style={styles.grid}>
                    <View style={styles.gridCell}>
                      <Text style={styles.fieldLabel}>Quantity</Text>
                      <TextInput style={styles.input} value={it.quantity} editable={!ro} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted} onChangeText={(v) => updateItem(it.key, 'quantity', v)} />
                    </View>
                    <View style={styles.gridCell}>
                      <ComboField label="Unit" value={it.unit} options={activeValues(config?.units)} disabled={ro} onChange={(v) => updateItem(it.key, 'unit', v)} />
                    </View>
                  </View>
                  <ComboField label="Description / Spec" value={it.description} options={activeValues(c.options)} disabled={ro} onChange={(v) => updateItem(it.key, 'description', v)} />
                  <Text style={styles.fieldLabel}>Notes</Text>
                  <TextInput style={styles.input} value={it.notes} editable={!ro} onChangeText={(v) => updateItem(it.key, 'notes', v)} />
                  {!ro ? (
                    <Pressable style={styles.removeBtn} onPress={() => removeItem(it)}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )
        })}

        {canDeleteTakeoffs() ? (
          <Pressable style={[styles.removeBtn, styles.deleteTakeoff]} onPress={deleteTakeoff}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={styles.removeText}>Delete takeoff</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {!ro ? (
        <View style={styles.footer}>
          <Text style={styles.footerText}>{dirty ? 'Unsaved changes' : 'All changes saved'}</Text>
          <Pressable style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]} disabled={!dirty || saving} onPress={save}>
            {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" size={20} color="#fff" />}
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
      ) : null}
    </AppScreen>
  )
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: 120, gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.divider },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 4 },
  infoLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  infoValue: { ...typography.sub, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  fieldLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.xs, marginBottom: 4 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    ...typography.body,
    color: colors.textPrimary,
  },
  multiline: { minHeight: 80, paddingTop: spacing.sm, textAlignVertical: 'top' },
  sectionHead: { marginTop: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  doorHead: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  doorTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  doorSummary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridCell: { width: '47%', flexGrow: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  addBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  smallAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: spacing.sm },
  addText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 15 },
  catHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  itemBox: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.background, gap: 4 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
  removeText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  deleteTakeoff: { marginTop: spacing.lg, alignSelf: 'center' },
  empty: { ...typography.caption, color: colors.muted, marginTop: 4 },
  error: { ...typography.body, color: colors.danger, marginTop: spacing.lg },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  footerText: { ...typography.sub, color: colors.textSecondary },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xl,
    minHeight: 50,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 17 },
})
