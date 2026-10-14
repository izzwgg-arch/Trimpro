import { StatusBar } from 'expo-status-bar'
import { ShareIntentProvider } from 'expo-share-intent'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import AppRoot from './src/AppRoot'

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ShareIntentProvider>
        <AppRoot />
        <StatusBar style="dark" />
      </ShareIntentProvider>
    </GestureHandlerRootView>
  )
}
