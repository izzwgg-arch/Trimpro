import React, { useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius, spacing, typography } from '../../theme/tokens'

/**
 * Tap to pick one of the options or type your own value. Typed text is saved exactly
 * as written (fractions, quotes, hyphens).
 */
export function ComboField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: string[]
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase()
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options
  }, [options, text])

  const close = () => setOpen(false)
  const pick = (next: string) => {
    onChange(next)
    close()
  }
  const typed = text.trim()

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.trigger, disabled && styles.triggerDisabled]}
        disabled={disabled}
        onPress={() => {
          setText(value)
          setOpen(true)
        }}
      >
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {value || 'Select or type'}
        </Text>
        {!disabled ? <Ionicons name="chevron-down" size={18} color={colors.textSecondary} /> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type to search or enter your own"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoFocus
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => pick(typed)}
            />
            {typed && !options.includes(typed) ? (
              <Pressable style={styles.useTyped} onPress={() => pick(typed)}>
                <Ionicons name="add-circle-outline" size={20} color="#fff" />
                <Text style={styles.useTypedText} numberOfLines={1}>
                  Use “{typed}”
                </Text>
              </Pressable>
            ) : null}
            <FlatList
              data={shown}
              keyExtractor={(o) => o}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 320 }}
              ListEmptyComponent={
                options.length === 0 ? <Text style={styles.empty}>No preset options — type the value above.</Text> : null
              }
              renderItem={({ item }) => (
                <Pressable style={[styles.option, item === value && styles.optionActive]} onPress={() => pick(item)}>
                  <Text style={styles.optionText}>{item}</Text>
                  {item === value ? <Ionicons name="checkmark" size={18} color={colors.brandPrimary} /> : null}
                </Pressable>
              )}
            />
            <View style={styles.footer}>
              {value ? (
                <Pressable style={styles.footerBtn} onPress={() => pick('')}>
                  <Text style={[styles.footerText, { color: colors.danger }]}>Clear</Text>
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable style={styles.footerBtn} onPress={close}>
                <Text style={styles.footerText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 140 },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginBottom: 4 },
  trigger: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  triggerDisabled: { backgroundColor: colors.background },
  value: { ...typography.body, color: colors.textPrimary, flex: 1 },
  placeholder: { color: colors.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  useTyped: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  useTypedText: { color: '#fff', fontWeight: '700', fontSize: 16, flex: 1 },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  optionActive: { backgroundColor: '#EEF2F6' },
  optionText: { ...typography.body, color: colors.textPrimary },
  empty: { ...typography.caption, color: colors.muted, paddingVertical: spacing.sm },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
  footerBtn: { paddingVertical: 10, paddingHorizontal: 6 },
  footerText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
})
