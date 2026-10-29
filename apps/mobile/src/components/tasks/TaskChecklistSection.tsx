import React, { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'

type Item = { id: string; title: string; isCompleted: boolean }

/** Task checklist: tap to tick, long-press to rename or remove, add new items. */
export function TaskChecklistSection({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient()
  const key = ['task-checklist', taskId]
  const query = useQuery({
    queryKey: key,
    queryFn: () => apiRequest<{ items: Item[] }>(`/api/tasks/${taskId}/checklist`),
  })
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const items = query.data?.items || []
  const setItems = (next: (prev: Item[]) => Item[]) =>
    queryClient.setQueryData<{ items: Item[] }>(key, (old) => ({ items: next(old?.items || []) }))

  const add = async () => {
    const title = draft.trim()
    if (!title || adding) return
    setAdding(true)
    try {
      const res = await apiRequest<{ item: Item }>(`/api/tasks/${taskId}/checklist`, 'POST', { title })
      setItems((prev) => [...prev, res.item])
      setDraft('')
    } catch (error: any) {
      Alert.alert('Could not add', error?.message || 'Try again.')
    } finally {
      setAdding(false)
    }
  }

  const toggle = async (item: Item) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isCompleted: !i.isCompleted } : i)))
    try {
      await apiRequest(`/api/tasks/${taskId}/checklist/${item.id}`, 'PATCH', { isCompleted: !item.isCompleted })
    } catch (error: any) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
      Alert.alert('Could not update', error?.message || 'Try again.')
    }
  }

  const saveRename = async () => {
    if (!editing) return
    const current = items.find((i) => i.id === editing.id)
    const title = editing.text.trim()
    setEditing(null)
    if (!current || !title || title === current.title) return
    try {
      const res = await apiRequest<{ item: Item }>(`/api/tasks/${taskId}/checklist/${current.id}`, 'PATCH', { title })
      setItems((prev) => prev.map((i) => (i.id === current.id ? res.item : i)))
    } catch (error: any) {
      Alert.alert('Could not rename', error?.message || 'Try again.')
    }
  }

  const remove = (item: Item) =>
    Alert.alert('Remove item?', item.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest(`/api/tasks/${taskId}/checklist/${item.id}`, 'DELETE')
            setItems((prev) => prev.filter((i) => i.id !== item.id))
          } catch (error: any) {
            Alert.alert('Could not remove', error?.message || 'Try again.')
          }
        },
      },
    ])

  const persistOrder = async (ordered: Item[]) => {
    setItems(() => ordered)
    try {
      const res = await apiRequest<{ items: Item[] }>(`/api/tasks/${taskId}/checklist/reorder`, 'POST', {
        ids: ordered.map((i) => i.id),
      })
      if (res?.items) setItems(() => res.items)
    } catch (error: any) {
      Alert.alert('Could not reorder', error?.message || 'Try again.')
      query.refetch()
    }
  }

  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir
    if (to < 0 || to >= items.length) return
    const next = items.slice()
    const [m] = next.splice(index, 1)
    next.splice(to, 0, m)
    void persistOrder(next)
  }

  const done = items.filter((i) => i.isCompleted).length

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.title}>Checklist</Text>
        {items.length > 0 ? <Text style={styles.count}>{done}/{items.length} done</Text> : null}
      </View>
      {query.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
      {items.map((item, index) =>
        editing?.id === item.id ? (
          <View key={item.id} style={styles.editRow}>
            <TextInput
              autoFocus
              style={[styles.input, { flex: 1 }]}
              value={editing.text}
              onChangeText={(text) => setEditing({ id: item.id, text })}
              onSubmitEditing={saveRename}
              onBlur={saveRename}
              returnKeyType="done"
            />
            <Pressable style={styles.iconBtn} onPress={() => remove(item)}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          </View>
        ) : (
          <View key={item.id} style={styles.row}>
            <Pressable
              style={styles.rowMain}
              onPress={() => toggle(item)}
              onLongPress={() => setEditing({ id: item.id, text: item.title })}
            >
              <Ionicons
                name={item.isCompleted ? 'checkbox' : 'square-outline'}
                size={26}
                color={item.isCompleted ? colors.success : colors.textSecondary}
              />
              <Text style={[styles.itemText, item.isCompleted && styles.itemDone]}>{item.title}</Text>
            </Pressable>
            <Pressable style={styles.moveBtn} onPress={() => move(index, -1)} disabled={index === 0} hitSlop={6}>
              <Ionicons name="chevron-up" size={20} color={index === 0 ? colors.muted : colors.textSecondary} />
            </Pressable>
            <Pressable
              style={styles.moveBtn}
              onPress={() => move(index, 1)}
              disabled={index === items.length - 1}
              hitSlop={6}
            >
              <Ionicons name="chevron-down" size={20} color={index === items.length - 1 ? colors.muted : colors.textSecondary} />
            </Pressable>
          </View>
        )
      )}
      {items.length > 0 ? <Text style={styles.hint}>Tap to tick · hold to edit · arrows to reorder</Text> : null}
      <View style={styles.editRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a checklist item"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          onSubmitEditing={add}
        />
        <Pressable style={[styles.addBtn, (!draft.trim() || adding) && { opacity: 0.5 }]} disabled={!draft.trim() || adding} onPress={add}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.h3, color: colors.textPrimary },
  count: { ...typography.sub, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48, paddingVertical: 4 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  moveBtn: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  itemText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  itemDone: { color: colors.muted, textDecorationLine: 'line-through' },
  hint: { ...typography.caption, color: colors.muted },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  iconBtn: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
})
