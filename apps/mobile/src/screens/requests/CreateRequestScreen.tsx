import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { InfiniteData, useQueryClient } from '@tanstack/react-query'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { BRAND } from '../../config/env'
import { JobsStackParamList } from '../../types/navigation'
import { AttachmentPickerSheet } from '../../components/attachments/AttachmentPickerSheet'
import { AttachmentUploadQueue } from '../../components/attachments/AttachmentUploadQueue'
import { pickAttachmentsByAction, uploadFileWithProgress } from '../../services/attachment-upload'
import { useAttachmentUploadQueue } from '../../hooks/useAttachmentUploadQueue'
import { extractCreatedRequestId } from './request-utils'

interface ResolvedAddress {
  street: string
  city: string
  state: string
  zipCode: string
  country?: string
}

type Props = NativeStackScreenProps<JobsStackParamList, 'RequestCreate'>

interface CreatedLead {
  id: string
  firstName?: string
  lastName?: string
  phone?: string | null
  email?: string | null
  jobSiteAddress?: string | null
  notes?: string | null
  status?: string
  source?: string
  createdAt?: string
}

interface CreateLeadResponse {
  lead?: CreatedLead
  id?: string
}

interface RequestDetailResponse {
  lead: CreatedLead
}

interface RequestsListResponse {
  leads: CreatedLead[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

interface UploadsApiResponse {
  url: string
  relativeUrl?: string
  mimeType?: string
  size?: number
  filename?: string
}

export function CreateRequestScreen({ navigation }: Props) {
  const queryClient = useQueryClient()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [jobSiteAddress, setJobSiteAddress] = useState('')
  const [addressPredictions, setAddressPredictions] = useState<string[]>([])
  const [addressSelectedFromSuggestions, setAddressSelectedFromSuggestions] = useState(false)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [isLoadingPredictions, setIsLoadingPredictions] = useState(false)
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false)

  const stagedUploadQueue = useAttachmentUploadQueue<UploadsApiResponse>({
    startUpload: (file, onProgress) => {
      const task = uploadFileWithProgress<UploadsApiResponse>('/api/uploads', file, onProgress)
      return {
        promise: task.promise.then((result) => result.raw),
        cancel: task.cancel,
      }
    },
  })

  useEffect(() => {
    const value = jobSiteAddress.trim()
    if (value.length < 3 || addressSelectedFromSuggestions) {
      setAddressPredictions([])
      return
    }

    const timer = setTimeout(async () => {
      try {
        setIsLoadingPredictions(true)
        const response = await apiRequest<{ predictions: string[] }>(
          `/api/mobile/places?q=${encodeURIComponent(value)}&limit=8`
        )
        setAddressPredictions(response.predictions || [])
      } catch {
        setAddressPredictions([])
      } finally {
        setIsLoadingPredictions(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [jobSiteAddress, addressSelectedFromSuggestions])

  const formatResolvedAddress = (address: ResolvedAddress): string => {
    const locality = [address.city, address.state, address.zipCode].filter(Boolean).join(' ')
    return [address.street, locality].filter(Boolean).join(', ')
  }

  const resolveAndSelectAddress = async (rawAddress: string): Promise<boolean> => {
    try {
      const resolved = await apiRequest<{ address: ResolvedAddress }>(
        `/api/mobile/places?mode=resolve&address=${encodeURIComponent(rawAddress)}`
      )
      setJobSiteAddress(formatResolvedAddress(resolved.address) || rawAddress.trim())
      setAddressPredictions([])
      setAddressSelectedFromSuggestions(true)
      return true
    } catch {
      Alert.alert('Address Error', 'Could not verify this address. Please include city/state or choose a suggestion.')
      return false
    }
  }

  const onSelectAttachmentAction = async (
    action: 'take-photo' | 'record-video' | 'choose-photos' | 'choose-videos' | 'choose-document'
  ) => {
    try {
      const picked = await pickAttachmentsByAction(action)
      if (!picked.length) return
      stagedUploadQueue.enqueueFiles(picked)
    } catch (error: any) {
      Alert.alert('Attachment selection failed', error?.message || 'Please try again.')
    }
  }

  const successfulUploads = useMemo(
    () =>
      stagedUploadQueue.items.filter(
        (item) => item.status === 'success' && item.result?.url
      ),
    [stagedUploadQueue.items]
  )

  const submit = async () => {
    if (!firstName || !lastName) {
      Alert.alert('Missing fields', 'First name and last name are required.')
      return
    }
    if (jobSiteAddress.trim().length > 0 && !addressSelectedFromSuggestions) {
      const resolved = await resolveAndSelectAddress(jobSiteAddress.trim())
      if (!resolved) return
    }
    if (stagedUploadQueue.hasUploading) {
      Alert.alert('Please wait', 'Please wait for file uploads to finish before creating the request.')
      return
    }
    if (stagedUploadQueue.failedCount > 0) {
      Alert.alert('Upload errors', 'Please retry or remove failed uploads before creating the request.')
      return
    }

    setLoading(true)
    try {
      const response = await apiRequest<CreateLeadResponse>('/api/leads', 'POST', {
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        jobSiteAddress: jobSiteAddress || null,
        notes: notes || null,
        source: 'OTHER',
        status: 'NEW',
      })
      const createdRequestId = extractCreatedRequestId(response)

      const detailResponse =
        response.lead?.createdAt && response.lead?.status
          ? { lead: response.lead }
          : await apiRequest<RequestDetailResponse>(`/api/leads/${createdRequestId}`)
      queryClient.setQueryData(['mobile-request-detail', createdRequestId], detailResponse)

      const attachErrors: string[] = []
      for (const queued of successfulUploads) {
        try {
          await apiRequest('/api/attachments', 'POST', {
            entityType: 'request',
            entityId: createdRequestId,
            fileName: queued.file.name,
            fileSize: Number(queued.result?.size || queued.file.sizeBytes || 0),
            mimeType: queued.file.mimeType,
            url: queued.result?.url,
            key: queued.result?.relativeUrl || queued.result?.filename || queued.result?.url,
          })
        } catch (error: any) {
          attachErrors.push(error?.message || `Failed to attach ${queued.file.name}`)
        }
      }

      queryClient.setQueryData<InfiniteData<RequestsListResponse>>(
        ['mobile-requests-list'],
        (existing) => {
          if (!existing?.pages?.length) return existing
          const createdLead = detailResponse.lead
          const firstPage = existing.pages[0]
          const deduped = (firstPage.leads || []).filter((lead) => lead.id !== createdLead.id)
          return {
            ...existing,
            pages: [
              {
                ...firstPage,
                leads: [createdLead, ...deduped],
                pagination: {
                  ...firstPage.pagination,
                  total: Number(firstPage.pagination?.total || 0) + 1,
                },
              },
              ...existing.pages.slice(1),
            ],
          }
        }
      )
      void queryClient.invalidateQueries({ queryKey: ['mobile-requests-list'] })

      setFirstName('')
      setLastName('')
      setPhone('')
      setEmail('')
      setJobSiteAddress('')
      setAddressPredictions([])
      setAddressSelectedFromSuggestions(false)
      setNotes('')
      stagedUploadQueue.setItems([])

      navigation.replace('RequestDetail', { requestId: createdRequestId })
      if (attachErrors.length > 0) {
        setTimeout(() => {
          Alert.alert(
            'Request created',
            `Request was created, but ${attachErrors.length} file(s) could not be attached.`
          )
        }, 0)
      }
    } catch (error: any) {
      Alert.alert('Failed', error?.message || 'Could not create request.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Create Request</Text>
        <TextInput
          style={styles.input}
          placeholder="First name"
          placeholderTextColor={BRAND.text}
          selectionColor={BRAND.text}
          cursorColor={BRAND.text}
          value={firstName}
          onChangeText={setFirstName}
        />
        <TextInput
          style={styles.input}
          placeholder="Last name"
          placeholderTextColor={BRAND.text}
          selectionColor={BRAND.text}
          cursorColor={BRAND.text}
          value={lastName}
          onChangeText={setLastName}
        />
        <TextInput
          style={styles.input}
          placeholder="Phone"
          placeholderTextColor={BRAND.text}
          selectionColor={BRAND.text}
          cursorColor={BRAND.text}
          value={phone}
          onChangeText={setPhone}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={BRAND.text}
          autoCapitalize="none"
          keyboardType="email-address"
          selectionColor={BRAND.text}
          cursorColor={BRAND.text}
          value={email}
          onChangeText={setEmail}
        />
        <View>
          <TextInput
            style={styles.input}
            placeholder="Job address (Google suggested)"
            placeholderTextColor={BRAND.text}
            selectionColor={BRAND.text}
            cursorColor={BRAND.text}
            value={jobSiteAddress}
            onChangeText={(text) => {
              setJobSiteAddress(text)
              setAddressSelectedFromSuggestions(false)
            }}
          />
          {isLoadingPredictions && <Text style={styles.hint}>Loading address suggestions...</Text>}
          {addressPredictions.length > 0 && (
            <View style={styles.suggestionsBox}>
              {addressPredictions.map((prediction) => (
                <Pressable key={prediction} style={styles.suggestionRow} onPress={async () => void resolveAndSelectAddress(prediction)}>
                  <Text style={styles.suggestionText}>{prediction}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {!isLoadingPredictions && jobSiteAddress.trim().length >= 3 && addressPredictions.length === 0 && (
            <Text style={styles.hint}>Searching Google suggestions... try adding city/state.</Text>
          )}
        </View>
        <TextInput
          style={[styles.input, styles.notes]}
          placeholder="Notes"
          placeholderTextColor={BRAND.text}
          selectionColor={BRAND.text}
          cursorColor={BRAND.text}
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        <View style={styles.uploadSection}>
          <View style={styles.uploadHeader}>
            <Ionicons name="attach-outline" size={18} color={BRAND.text} />
            <Text style={styles.uploadTitle}>Attachments (before save)</Text>
          </View>
          <Pressable style={styles.uploadButton} onPress={() => setShowAttachmentPicker(true)}>
            <Ionicons name="add-circle-outline" size={18} color={BRAND.primary} />
            <Text style={styles.uploadButtonText}>Add Attachment</Text>
          </Pressable>
          <Text style={styles.uploadHint}>
            Supports photos, videos, PDF, Word, Excel, CSV, PowerPoint, and TXT.
          </Text>
          <AttachmentUploadQueue
            items={stagedUploadQueue.items}
            onRetry={(item) => stagedUploadQueue.retryItem(item.id)}
            onRemove={(item) => stagedUploadQueue.removeItem(item.id)}
            onCancel={(item) => stagedUploadQueue.cancelItem(item.id)}
          />
        </View>

        <Pressable
          style={[styles.button, (loading || stagedUploadQueue.hasUploading) && styles.buttonDisabled]}
          onPress={submit}
          disabled={loading || stagedUploadQueue.hasUploading}
        >
          <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Request'}</Text>
        </Pressable>
      </ScrollView>
      <AttachmentPickerSheet
        visible={showAttachmentPicker}
        onClose={() => setShowAttachmentPicker(false)}
        onSelect={onSelectAttachmentAction}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14 },
  scrollContent: { gap: 10, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '800', color: BRAND.text, marginBottom: 8 },
  input: {
    backgroundColor: BRAND.white,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: BRAND.text,
  },
  hint: {
    marginTop: 6,
    color: BRAND.text,
    fontSize: 12,
  },
  suggestionsBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 12,
    backgroundColor: BRAND.white,
  },
  suggestionRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EAECF0',
  },
  suggestionText: {
    color: BRAND.text,
    fontSize: 14,
  },
  notes: { minHeight: 100, textAlignVertical: 'top' },
  uploadSection: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  uploadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  uploadTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: BRAND.text,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRAND.primary,
  },
  uploadButtonText: {
    color: BRAND.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  uploadHint: {
    fontSize: 11,
    color: '#6B7280',
  },
  button: { backgroundColor: BRAND.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: BRAND.white, fontWeight: '700' },
})

