import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { EmptyState } from '../../components/EmptyState'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { JobsStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<JobsStackParamList, 'GlobalSearch'>

interface SearchResult {
  id: string
  entityType: string
  title: string
  subtitle: string
  url: string
  score: number
}
interface SearchGroup {
  type: string
  label: string
  results: SearchResult[]
}
interface SearchResponse {
  groups: SearchGroup[]
}

// Entity types that open a native screen in the app; everything else is shown
// but opens on the web dashboard (no native detail screen exists yet).
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  job: 'construct-outline',
  task: 'checkbox-outline',
  issue: 'alert-circle-outline',
  request: 'megaphone-outline',
  measuring: 'resize-outline',
  schedule: 'calendar-outline',
  client: 'people-outline',
  customer: 'people-outline',
  contact: 'person-outline',
  vendor: 'business-outline',
  estimate: 'document-text-outline',
  invoice: 'receipt-outline',
  payment: 'cash-outline',
  purchaseOrder: 'cart-outline',
  item: 'cube-outline',
  creditMemo: 'card-outline',
  user: 'person-circle-outline',
  call: 'call-outline',
  file: 'document-outline',
  note: 'reader-outline',
}
const iconFor = (t: string): keyof typeof Ionicons.glyphMap => ICONS[t] || 'search-outline'

export function GlobalSearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<TextInput>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 280)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    if (debounced.length < 2) {
      setGroups([])
      setLoading(false)
      return
    }
    setLoading(true)
    apiRequest<SearchResponse>(`/api/search?q=${encodeURIComponent(debounced)}&limit=10`)
      .then((res) => {
        if (!cancelled) setGroups(res.groups || [])
      })
      .catch(() => {
        if (!cancelled) setGroups([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  const sections = useMemo(
    () => groups.filter((g) => g.results.length > 0).map((g) => ({ title: g.label, type: g.type, data: g.results })),
    [groups]
  )

  const openResult = (r: SearchResult) => {
    Keyboard.dismiss()
    const parent: any = navigation.getParent()
    switch (r.entityType) {
      case 'job':
        navigation.navigate('AdminJobDetail', { jobId: r.id })
        return
      case 'request':
        navigation.navigate('RequestDetail', { requestId: r.id })
        return
      case 'measuring':
        navigation.navigate('MeasuringRequestDetail', { measuringRequestId: r.id })
        return
      case 'task':
        parent?.navigate('TasksTab', { screen: 'TaskDetail', params: { taskId: r.id } })
        return
      case 'issue':
        parent?.navigate('IssuesTab', { screen: 'IssueDetail', params: { issueId: r.id } })
        return
      case 'schedule':
        parent?.navigate('ScheduleTab', { screen: 'ScheduleDetail', params: { scheduleId: r.id } })
        return
      default:
        Alert.alert(r.title, 'This item opens on the web dashboard — there is no mobile screen for it yet.')
    }
  }

  const totalCount = sections.reduce((n, s) => n + s.data.length, 0)

  return (
    <AppScreen padded={false}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search jobs, clients, invoices, requests…"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : debounced.length < 2 ? (
        <View style={styles.center}>
          <EmptyState icon="search-outline" title="Search everything" description="Find jobs, clients, invoices, estimates, requests, tasks, issues and more." />
        </View>
      ) : totalCount === 0 ? (
        <View style={styles.center}>
          <EmptyState icon="search-outline" title="No results" description={`Nothing matches "${debounced}".`} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.entityType}:${item.id}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Pressable onPress={() => openResult(item)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <View style={styles.rowIcon}>
                <Ionicons name={iconFor(item.entityType)} size={18} color={colors.brandPrimary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                {item.subtitle ? <Text style={styles.rowSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          )}
        />
      )}
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, paddingHorizontal: spacing.md, height: 44 },
  input: { flex: 1, ...typography.sub, color: colors.textPrimary, padding: 0 },
  cancel: { ...typography.sub, color: colors.brandPrimary, fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  listContent: { paddingBottom: spacing.xxl },
  sectionHeader: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowPressed: { backgroundColor: '#F1F5F9' },
  rowIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '600' },
  rowSubtitle: { ...typography.caption, color: colors.textSecondary },
})
