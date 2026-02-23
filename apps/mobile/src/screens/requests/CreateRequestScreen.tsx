import React, { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { BRAND } from '../../config/env'

interface ResolvedAddress {
  street: string
  city: string
  state: string
  zipCode: string
  country?: string
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

  const submit = async () => {
    if (!firstName || !lastName) {
      Alert.alert('Missing fields', 'First name and last name are required.')
      return
    }
    if (jobSiteAddress.trim().length > 0 && !addressSelectedFromSuggestions) {
      const resolved = await resolveAndSelectAddress(jobSiteAddress.trim())
      if (!resolved) return
    }

    setLoading(true)
    try {
      await apiRequest('/api/leads', 'POST', {
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        jobSiteAddress: jobSiteAddress || null,
        notes: notes || null,
        source: 'OTHER',
        status: 'NEW',
      })
      setFirstName('')
      setLastName('')
      setPhone('')
      setEmail('')
      setJobSiteAddress('')
      setAddressPredictions([])
      setAddressSelectedFromSuggestions(false)
      setNotes('')
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
      <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={submit} disabled={loading}>
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
  button: { backgroundColor: BRAND.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: BRAND.white, fontWeight: '700' },
})

