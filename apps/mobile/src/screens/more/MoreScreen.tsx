import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Screen } from '../../components/Screen'
import { BRAND } from '../../config/env'
import { MoreStackParamList } from '../../types/navigation'
import { useOutboxCount } from '../../hooks/useOutboxCount'

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreHome'>

export function MoreScreen({ navigation }: Props) {
  const outboxCount = useOutboxCount()
  return (
    <Screen style={styles.screen}>
      <Text style={styles.title}>More</Text>
      <View style={styles.card}>
        <MenuButton label="Requests" onPress={() => navigation.navigate('Requests')} />
        <MenuButton label="Issues" onPress={() => navigation.navigate('Issues')} />
        <MenuButton label="Calls" onPress={() => navigation.navigate('Calls')} />
        <MenuButton label={`Outbox${outboxCount > 0 ? ` (${outboxCount})` : ''}`} onPress={() => navigation.navigate('Outbox')} />
        <MenuButton label="Profile" onPress={() => navigation.navigate('Profile')} />
      </View>
    </Screen>
  )
}

function MenuButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.menuButton} onPress={onPress}>
      <Text style={styles.menuText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14 },
  title: { fontSize: 24, fontWeight: '800', color: BRAND.text, marginBottom: 12 },
  card: { backgroundColor: BRAND.white, borderRadius: 12, padding: 8 },
  menuButton: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  menuText: { color: BRAND.text, fontSize: 16, fontWeight: '600' },
})

