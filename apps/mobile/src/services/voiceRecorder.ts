import { Audio } from 'expo-av'

type RecorderPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'canceling'

export interface VoiceStopResult {
  uri: string
  durationMs: number
  mime: string
}

export class VoiceRecorder {
  private recording: Audio.Recording | null = null
  private phase: RecorderPhase = 'idle'
  private activeOperation: Promise<void> | null = null

  isRecording() {
    return this.phase === 'recording'
  }

  getPhase() {
    return this.phase
  }

  private getAudioModeOptions(allowsRecording: boolean) {
    return {
      allowsRecordingIOS: allowsRecording,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    }
  }

  async start(): Promise<void> {
    if (this.phase === 'starting' || this.phase === 'recording' || this.phase === 'stopping' || this.phase === 'canceling') {
      this.devLog('start ignored', { phase: this.phase })
      return
    }

    const run = async () => {
      this.transition('starting')
      try {
        await this.forceCleanup()

        const permission = await Audio.requestPermissionsAsync()
        if (!permission.granted) {
          throw new Error('Microphone permission denied')
        }

        await Audio.setAudioModeAsync(this.getAudioModeOptions(true))

        const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
        this.recording = created.recording
        this.transition('recording')
      } catch (error: any) {
        console.error('[voice-recorder] start failed', error, error?.stack)
        await this.forceCleanup()
        this.transition('idle')
        throw error
      } finally {
        this.activeOperation = null
      }
    }

    this.activeOperation = run()
    return this.activeOperation
  }

  async stop(): Promise<VoiceStopResult> {
    if (this.phase === 'starting' && this.activeOperation) {
      await this.activeOperation
    }
    if (this.phase === 'stopping' || this.phase === 'canceling') {
      throw new Error('Recorder busy')
    }
    if (!this.recording) {
      throw new Error('No active recording')
    }

    const run = async () => {
      this.transition('stopping')
      try {
        const current = this.recording
        const status = await current.getStatusAsync()
        const uri = current.getURI()
        const durationMs = status.isLoaded ? status.durationMillis || 0 : 0

        await current.stopAndUnloadAsync()
        this.recording = null

        await this.resetAudioMode()
        this.transition('idle')

        if (!uri) throw new Error('Recording URI is unavailable')
        return { uri, durationMs, mime: 'audio/m4a' }
      } catch (error: any) {
        console.error('[voice-recorder] stop failed', error, error?.stack)
        await this.forceCleanup()
        this.transition('idle')
        throw error
      } finally {
        this.activeOperation = null
      }
    }

    const op = run()
    this.activeOperation = op.then(() => undefined, () => undefined)
    return op
  }

  async cancel(): Promise<void> {
    if (this.phase === 'starting' && this.activeOperation) {
      await this.activeOperation.catch(() => {})
    }
    if (this.phase === 'canceling') return
    if (!this.recording && this.phase === 'idle') return

    const run = async () => {
      this.transition('canceling')
      try {
        await this.forceCleanup()
      } catch (error: any) {
        console.error('[voice-recorder] cancel failed', error, error?.stack)
      } finally {
        this.transition('idle')
        this.activeOperation = null
      }
    }

    this.activeOperation = run()
    return this.activeOperation
  }

  async forceCleanup(): Promise<void> {
    if (!this.recording) {
      await this.resetAudioMode()
      return
    }

    const current = this.recording
    this.recording = null
    try {
      const status = await current.getStatusAsync()
      if (status.isLoaded && status.isRecording) {
        await current.stopAndUnloadAsync()
      } else if (status.isLoaded) {
        await current.unloadAsync()
      }
    } catch (error) {
      try {
        await current.stopAndUnloadAsync()
      } catch {
        try {
          await current.unloadAsync()
        } catch {
          // no-op
        }
      }
    } finally {
      await this.resetAudioMode()
    }
  }

  private async resetAudioMode() {
    try {
      await Audio.setAudioModeAsync(this.getAudioModeOptions(false))
    } catch (error) {
      this.devLog('resetAudioMode failed', error)
    }
  }

  private transition(next: RecorderPhase) {
    if (__DEV__) {
      console.log(`[voice-recorder] ${this.phase} -> ${next}`)
    }
    this.phase = next
  }

  private devLog(message: string, payload?: unknown) {
    if (__DEV__) {
      console.log(`[voice-recorder] ${message}`, payload ?? '')
    }
  }
}
