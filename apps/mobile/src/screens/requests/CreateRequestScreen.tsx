import React, { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput } from 'react-native'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { BRAND } from '../../config/env'

export function CreateRequestScreen() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!firstName || !lastName) {
      Alert.alert('Missing fields', 'First name and last name are required.')
      return
    }
    setLoading(true)
    try {
      await apiRequest('/api/leads', 'POST', {
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        source: 'OTHER',
        status: 'NEW',
      })
      setFirstName('')
      setLastName('')
      setPhone('')
      setEmail('')
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
      <Text style={styles.title}>Create Request</Text>
      <TextInput style={styles.input} placeholder="First name" value={firstName} onChangeText={setFirstName} />
      <TextInput style={styles.input} placeholder="Last name" value={lastName} onChangeText={setLastName} />
      <TextInput style={styles.input} placeholder="Phone" value={phone} onChangeText={setPhone} />
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={[styles.input, styles.notes]}
        placeholder="Notes"
        value={notes}
        onChangeText={setNotes}
        multiline
      />
      <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={submit} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Request'}</Text>
      </Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14, gap: 10 },
  title: { fontSize: 24, fontWeight: '800', color: BRAND.text, marginBottom: 8 },
  input: {
    backgroundColor: BRAND.white,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  notes: { minHeight: 100, textAlignVertical: 'top' },
  button: { backgroundColor: BRAND.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: BRAND.white, fontWeight: '700' },
})

