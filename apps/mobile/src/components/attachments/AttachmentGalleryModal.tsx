import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Audio, ResizeMode, Video } from 'expo-av'
import { WebView } from 'react-native-webview'
import { ImageMarkupWebView } from './ImageMarkupWebView'
import {
  getAttachmentKind,
  normalizeAttachmentUrl,
  openAttachment,
} from '../../services/open-attachment'
import { BRAND } from '../../config/env'

export type GalleryAttachment = {
  id: string
  fileName: string
  fileSize?: number
  mimeType: string
  url: string
}

type Props = {
  visible: boolean
  attachments: GalleryAttachment[]
  index: number
  onClose: () => void
  onIndexChange: (index: number) => void
}

function formatBytes(bytes?: number) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function AttachmentGalleryModal({
  visible,
  attachments,
  index,
  onClose,
  onIndexChange,
}: Props) {
  const total = attachments.length
  const safeIndex = total > 0 ? ((index % total) + total) % total : 0
  const current = total > 0 ? attachments[safeIndex] : null
  const url = current ? normalizeAttachmentUrl(current.url) : ''
  const kind = current ? getAttachmentKind(current.mimeType, current.fileName) : 'other'
  const canNavigate = total > 1
  const [opening, setOpening] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const soundRef = useRef<Audio.Sound | null>(null)

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync()
      soundRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      await soundRef.current?.unloadAsync()
      soundRef.current = null
      if (!visible || kind !== 'audio' || !url) return
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
        const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true })
        if (cancelled) {
          await sound.unloadAsync()
          return
        }
        soundRef.current = sound
      } catch {
        // User can still tap Open.
      }
    }
    void run()
    return () => {
      cancelled = true
      void soundRef.current?.unloadAsync()
      soundRef.current = null
    }
  }, [visible, kind, url, current?.id])

  // Android WebView can render PDFs from https://, but not from content:// / file://.
  // Probe the remote URL; if it fails, show Open button (system viewer).
  useEffect(() => {
    let cancelled = false
    setPdfError(null)
    if (!visible || kind !== 'pdf' || !url) {
      setPdfLoading(false)
      return
    }

    setPdfLoading(true)
    const timer = setTimeout(() => {
      if (!cancelled) setPdfLoading(false)
    }, 1200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [visible, kind, url, current?.id])

  // Do not auto-open non-previewable docs — wait for explicit Open tap.
  const goPrev = () => {
    if (!canNavigate) return
    onIndexChange((safeIndex - 1 + total) % total)
  }

  const goNext = () => {
    if (!canNavigate) return
    onIndexChange((safeIndex + 1) % total)
  }

  const onOpenExternal = async () => {
    if (!current) return
    setOpening(true)
    try {
      await openAttachment({
        url: current.url,
        fileName: current.fileName,
        mimeType: current.mimeType,
      })
    } finally {
      setOpening(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title} numberOfLines={1}>
              {current?.fileName || 'Attachment'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {total > 0 ? `${safeIndex + 1} of ${total}` : '0 of 0'}
              {current?.fileSize ? ` · ${formatBytes(current.fileSize)}` : ''}
              {current?.mimeType ? ` · ${current.mimeType}` : ''}
            </Text>
          </View>
          <Pressable style={styles.headerBtn} onPress={onOpenExternal} disabled={!current || opening}>
            {opening ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="open-outline" size={16} color="#fff" />
                <Text style={styles.headerBtnText}>Open</Text>
              </>
            )}
          </Pressable>
          <Pressable style={styles.headerBtn} onPress={onClose}>
            <Text style={styles.headerBtnText}>Close</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          {canNavigate ? (
            <Pressable style={[styles.navBtn, styles.navLeft]} onPress={goPrev}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </Pressable>
          ) : null}

          {!current ? (
            <Text style={styles.empty}>No attachments</Text>
          ) : kind === 'image' ? (
            <ImageMarkupWebView key={current.id} src={url} fileName={current.fileName} active={visible} />
          ) : kind === 'video' ? (
            <Video
              key={current.id}
              source={{ uri: url }}
              style={styles.video}
              useNativeControls
              shouldPlay
              resizeMode={ResizeMode.CONTAIN}
            />
          ) : kind === 'audio' ? (
            <View style={styles.centerCard}>
              <Ionicons name="musical-notes-outline" size={48} color="#fff" />
              <Text style={styles.centerTitle}>{current.fileName}</Text>
              <Text style={styles.meta}>Playing audio… Use Open to share/download.</Text>
            </View>
          ) : kind === 'pdf' ? (
            pdfLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={[styles.meta, { marginTop: 12 }]}>Loading PDF…</Text>
              </View>
            ) : url ? (
              <View style={styles.fill}>
                <WebView
                  key={`${current.id}-${url}`}
                  source={{ uri: url }}
                  style={styles.fill}
                  originWhitelist={['*']}
                  allowFileAccess
                  allowUniversalAccessFromFileURLs
                  mixedContentMode="always"
                  setSupportMultipleWindows={false}
                  startInLoadingState
                  onError={() => setPdfError('PDF preview failed. Tap Open to use a viewer app.')}
                  onHttpError={() => setPdfError('PDF preview failed. Tap Open to use a viewer app.')}
                  renderLoading={() => (
                    <View style={styles.loading}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  )}
                />
                {pdfError ? (
                  <View style={styles.pdfFallback}>
                    <Text style={styles.meta}>{pdfError}</Text>
                    <Pressable style={styles.primaryBtn} onPress={onOpenExternal} disabled={opening}>
                      <Text style={styles.primaryBtnText}>{opening ? 'Opening…' : 'Open in Viewer App'}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.centerCard}>
                <Ionicons name="document-outline" size={48} color="#fff" />
                <Text style={styles.centerTitle}>{current.fileName}</Text>
                <Text style={styles.meta}>PDF preview unavailable on this device.</Text>
                <Pressable style={styles.primaryBtn} onPress={onOpenExternal} disabled={opening}>
                  <Text style={styles.primaryBtnText}>{opening ? 'Opening…' : 'Open in Viewer App'}</Text>
                </Pressable>
              </View>
            )
          ) : (
            <View style={styles.centerCard}>
              <Ionicons name="document-text-outline" size={48} color="#fff" />
              <Text style={styles.centerTitle}>{current.fileName}</Text>
              <Text style={styles.meta}>Tap Open to view this file in another app.</Text>
              <Pressable style={styles.primaryBtn} onPress={onOpenExternal} disabled={opening}>
                <Text style={styles.primaryBtnText}>{opening ? 'Opening…' : 'Open Document'}</Text>
              </Pressable>
            </View>
          )}

          {canNavigate ? (
            <Pressable style={[styles.navBtn, styles.navRight]} onPress={goNext}>
              <Ionicons name="chevron-forward" size={28} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#09090b' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerTextWrap: { flex: 1, minWidth: 0 },
  title: { color: '#fff', fontSize: 14, fontWeight: '700' },
  meta: { color: '#a1a1aa', fontSize: 12, marginTop: 2, textAlign: 'center' },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 64,
    justifyContent: 'center',
  },
  headerBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  body: { flex: 1, minHeight: 0, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },
  video: { width: '100%', height: '100%' },
  empty: { color: '#a1a1aa', textAlign: 'center', marginTop: 40 },
  centerCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  centerTitle: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: BRAND.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  navBtn: {
    position: 'absolute',
    top: '45%',
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLeft: { left: 8 },
  navRight: { right: 8 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  pdfFallback: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
})
