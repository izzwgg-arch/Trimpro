import React, { useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Issue } from '../../types/models'
import { IssuesStackParamList } from '../../types/navigation'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, typography } from '../../theme/tokens'
import { EmptyState } from '../../components/EmptyState'
import { PressableCard } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { SectionHeader } from '../../components/SectionHeader'

interface IssuesResponse {
  issues: Issue[]
}

type Props = NativeStackScreenProps<IssuesStackParamList, 'IssuesList'>

export function IssuesScreen({ navigation }: Props) {
  const { canCreateIssues, canAssignIssuesToAdmin } = useMobilePermissions()
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [issueTitle, setIssueTitle] = useState('')
  const [issueDescription, setIssueDescription] = useState('')
  const [issueNotes, setIssueNotes] = useState('')

  const query = useQuery({
    queryKey: ['mobile-issues'],
    queryFn: () => apiRequest<IssuesResponse>('/api/issues?filter=assigned_or_created&limit=100'),
    refetchInterval: 60_000,
  })

  const createIssueMutation = useMutation({
    mutationFn: async () => {
      // Get admin users for assignment
      const usersResponse = await apiRequest<{ users: Array<{ id: string; role: string; firstName: string; lastName: string }> }>(
        '/api/users?role=ADMIN&limit=10'
      )
      const adminUsers = usersResponse.users.filter((u) => u.role === 'ADMIN' || u.role === 'OFFICE')
      
      if (adminUsers.length === 0) {
        throw new Error('No admin users found to assign the issue to.')
      }

      const assigneeId = adminUsers[0].id
      const descriptionWithNotes = [issueDescription.trim(), issueNotes.trim() ? `Notes:\n${issueNotes.trim()}` : '']
        .filter(Boolean)
        .join('\n\n')
      
      return apiRequest('/api/issues?mobile=true', 'POST', {
        title: issueTitle.trim(),
        description: descriptionWithNotes || null,
        assigneeId,
        type: 'OTHER',
        priority: 'MEDIUM',
        status: 'OPEN',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobile-issues'] })
      queryClient.invalidateQueries({ queryKey: ['mobile-assignments'] })
      setIssueTitle('')
      setIssueDescription('')
      setIssueNotes('')
      setShowCreateForm(false)
      Alert.alert('Success', 'Issue created and assigned to admin')
    },
    onError: (error: any) => {
      Alert.alert('Error', error?.message || 'Failed to create issue')
    },
  })

  return (
    <AppScreen>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Issues</Text>
            <Text style={styles.subtitle}>Track open field issues and resolve them quickly.</Text>
          </View>
          {canCreateIssues() && canAssignIssuesToAdmin() && (
            <Pressable
              style={styles.createButton}
              onPress={() => setShowCreateForm((prev) => !prev)}
              disabled={createIssueMutation.isPending}
            >
              <Ionicons name="add" size={24} color="#E6C98B" />
            </Pressable>
          )}
        </View>
      </View>
      {showCreateForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Create Issue</Text>
          <TextInput
            style={styles.input}
            placeholder="Title"
            placeholderTextColor={colors.textPrimary}
            selectionColor={colors.textPrimary}
            cursorColor={colors.textPrimary}
            value={issueTitle}
            onChangeText={setIssueTitle}
          />
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="Description"
            placeholderTextColor={colors.textPrimary}
            selectionColor={colors.textPrimary}
            cursorColor={colors.textPrimary}
            value={issueDescription}
            onChangeText={setIssueDescription}
            multiline
          />
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="Notes"
            placeholderTextColor={colors.textPrimary}
            selectionColor={colors.textPrimary}
            cursorColor={colors.textPrimary}
            value={issueNotes}
            onChangeText={setIssueNotes}
            multiline
          />
          <View style={styles.formActions}>
            <Pressable
              style={[styles.actionButton, styles.cancelButton]}
              onPress={() => {
                setShowCreateForm(false)
                setIssueTitle('')
                setIssueDescription('')
                setIssueNotes('')
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.saveButton, (!issueTitle.trim() || createIssueMutation.isPending) && styles.disabledButton]}
              onPress={() => createIssueMutation.mutate()}
              disabled={!issueTitle.trim() || createIssueMutation.isPending}
            >
              <Text style={styles.saveButtonText}>{createIssueMutation.isPending ? 'Saving...' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      )}
      <FlatList
        data={query.data?.issues ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListHeaderComponent={<SectionHeader title="Active Issues" />}
        ListEmptyComponent={<EmptyState icon="alert-circle-outline" title="No issues yet" description="Assigned and created issues will appear here." />}
        renderItem={({ item }) => (
          <PressableCard
            style={styles.card}
            onPress={() => navigation.navigate('IssueDetail', { issueId: item.id })}
          >
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.meta}>{item.description || 'No description'}</Text>
            <Text style={styles.meta}>Priority: {item.priority}</Text>
          </PressableCard>
        )}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { marginBottom: spacing.sm },
  cardTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  meta: { ...typography.caption, color: colors.textSecondary },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    gap: spacing.xs,
  },
  formTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: 4,
  },
  actionButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
  },
  saveButton: {
    backgroundColor: colors.brandPrimary,
  },
  cancelButtonText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  saveButtonText: {
    ...typography.caption,
    color: '#E6C98B',
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
})

