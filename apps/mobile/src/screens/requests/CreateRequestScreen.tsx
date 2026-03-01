import React, { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, ActivityIndicator, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import { Ionicons } from '@expo/vector-icons'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { BRAND } from '../../config/env'
import { API_BASE_URL } from '../../config/env'

interface ResolvedAddress {
  street: string
  city: string
  state: string
  zipCode: string
  country?: string
}

interface StagedAttachment {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  uri: string
  status: 'uploading' | 'uploaded' | 'failed'
  error?: string
  url?: string
  key?: string
}

export function CreateRequestScreen() {
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
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)

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

  const pickDocuments = async () => {
    try {
      // Request permission for media library
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('Permission required', 'Please grant access to your photo library to upload files.')
        return
      }
      
      // For now, use ImagePicker which supports images
      // TODO: Install expo-document-picker for PDF/DOCX support
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.9,
      })
      
      if (result.canceled || !result.assets || result.assets.length === 0) return
      
      const maxSize = 10 * 1024 * 1024 // 10MB
      
      for (const asset of result.assets) {
        if (!asset.uri) continue
        
        const fileName = asset.fileName || `image-${Date.now()}.jpg`
        const fileSize = asset.fileSize || 0
        const mimeType = asset.mimeType || 'image/jpeg'
        
        // Validate file size
        if (fileSize > maxSize) {
          Alert.alert('File too large', `File ${fileName} is too large (max 10MB per file)`)
          continue
        }
        
        // Validate file type (only images for now, PDF/DOCX requires expo-document-picker)
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png']
        if (!allowedTypes.includes(mimeType.toLowerCase())) {
          Alert.alert('Invalid file type', `Only JPG and PNG images are supported on mobile. PDF and DOCX support coming soon.`)
          continue
        }
        
        const tempId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        setStagedAttachments(prev => [...prev, {
          id: tempId,
          fileName,
          fileSize,
          mimeType,
          uri: asset.uri,
          status: 'uploading',
        }])
        
        // Upload file
        try {
          const token = await SecureStore.getItemAsync('accessToken')
          if (!token) {
            throw new Error('Not authenticated')
          }
          
          const uploadResult = await FileSystem.uploadAsync(`${API_BASE_URL}/api/uploads`, asset.uri, {
            fieldName: 'file',
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
            mimeType,
          })
          
          if (uploadResult.status < 200 || uploadResult.status >= 300) {
            const errorData = uploadResult.body ? JSON.parse(uploadResult.body) : {}
            throw new Error(errorData.error || 'Upload failed')
          }
          
          const uploadData = JSON.parse(uploadResult.body)
          setStagedAttachments(prev => prev.map(item => 
            item.id === tempId 
              ? { ...item, status: 'uploaded', url: uploadData.url, key: uploadData.relativeUrl || uploadData.filename || uploadData.url }
              : item
          ))
        } catch (error: any) {
          setStagedAttachments(prev => prev.map(item => 
            item.id === tempId 
              ? { ...item, status: 'failed', error: error?.message || 'Upload failed' }
              : item
          ))
        }
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to pick documents')
    }
  }
  
  const removeStagedAttachment = (id: string) => {
    setStagedAttachments(prev => prev.filter(item => item.id !== id))
  }

  const submit = async () => {
    if (!firstName || !lastName) {
      Alert.alert('Missing fields', 'First name and last name are required.')
      return
    }
    if (jobSiteAddress.trim().length > 0 && !addressSelectedFromSuggestions) {
      const resolved = await resolveAndSelectAddress(jobSiteAddress.trim())
      if (!resolved) return
    }
    
    const uploadingCount = stagedAttachments.filter(a => a.status === 'uploading').length
    if (uploadingCount > 0) {
      Alert.alert('Please wait', 'Please wait for file uploads to finish before creating the request.')
      return
    }
    const failedCount = stagedAttachments.filter(a => a.status === 'failed').length
    if (failedCount > 0) {
      Alert.alert('Upload errors', 'Please remove failed uploads or try uploading those files again.')
      return
    }

    setLoading(true)
    try {
      const response = await apiRequest<{ lead: { id: string } }>('/api/leads', 'POST', {
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        jobSiteAddress: jobSiteAddress || null,
        notes: notes || null,
        source: 'OTHER',
        status: 'NEW',
      })
      
      // Attach uploaded files to the request
      const uploadedAttachments = stagedAttachments.filter(a => a.status === 'uploaded')
      if (uploadedAttachments.length > 0 && response.lead?.id) {
        const token = await SecureStore.getItemAsync('accessToken')
        const attachErrors: string[] = []
        for (const attachment of uploadedAttachments) {
          try {
            await apiRequest('/api/attachments', 'POST', {
              entityType: 'request',
              entityId: response.lead.id,
              fileName: attachment.fileName,
              fileSize: attachment.fileSize,
              mimeType: attachment.mimeType,
              url: attachment.url,
              key: attachment.key || attachment.url,
            })
          } catch (error: any) {
            attachErrors.push(error?.message || `Failed to attach ${attachment.fileName}`)
          }
        }
        if (attachErrors.length > 0) {
          Alert.alert('Request created', `Request was created, but ${attachErrors.length} file(s) could not be attached.`)
        }
      }
      
      setFirstName('')
      setLastName('')
      setPhone('')
      setEmail('')
      setJobSiteAddress('')
      setAddressPredictions([])
      setAddressSelectedFromSuggestions(false)
      setNotes('')
      setStagedAttachments([])
      Alert.alert('Created', 'Request was created successfully.')
    } catch (error: any) {
      Alert.alert('Failed', error?.message || 'Could not create request.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen style={styles.screen}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scrollContent}
      >
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
              <Pressable
                key={prediction}
                style={styles.suggestionRow}
                onPress={async () => {
                  await resolveAndSelectAddress(prediction)
                }}
              >
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
        <Pressable style={styles.uploadButton} onPress={pickDocuments} disabled={uploadingFiles}>
          <Ionicons name="cloud-upload-outline" size={18} color={BRAND.primary} />
          <Text style={styles.uploadButtonText}>Upload Files</Text>
        </Pressable>
        <Text style={styles.uploadHint}>JPG, PNG images (max 10MB each). PDF/DOCX support coming soon.</Text>
        
        {stagedAttachments.length > 0 && (
          <View style={styles.attachmentsList}>
            {stagedAttachments.map((attachment) => (
              <View key={attachment.id} style={styles.attachmentItem}>
                <View style={styles.attachmentInfo}>
                  <Text style={styles.attachmentName} numberOfLines={1}>{attachment.fileName}</Text>
                  <Text style={styles.attachmentStatus}>
                    {attachment.status === 'uploading' && 'Uploading...'}
                    {attachment.status === 'uploaded' && 'Uploaded'}
                    {attachment.status === 'failed' && `Failed: ${attachment.error || 'Upload failed'}`}
                  </Text>
                </View>
                {attachment.status === 'uploading' ? (
                  <ActivityIndicator size="small" color={BRAND.primary} />
                ) : (
                  <Pressable onPress={() => removeStagedAttachment(attachment.id)}>
                    <Ionicons name="trash-outline" size={20} color="#DC2626" />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
      
      <Pressable 
        style={[styles.button, (loading || stagedAttachments.some(a => a.status === 'uploading')) && styles.buttonDisabled]} 
        onPress={submit} 
        disabled={loading || stagedAttachments.some(a => a.status === 'uploading')}
      >
        <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Request'}</Text>
      </Pressable>
      </ScrollView>
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
  attachmentsList: {
    marginTop: 8,
    gap: 6,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    backgroundColor: BRAND.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  attachmentInfo: {
    flex: 1,
    marginRight: 8,
  },
  attachmentName: {
    fontSize: 13,
    fontWeight: '600',
    color: BRAND.text,
  },
  attachmentStatus: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  button: { backgroundColor: BRAND.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: BRAND.white, fontWeight: '700' },
})

