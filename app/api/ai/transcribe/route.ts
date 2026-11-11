import { NextRequest, NextResponse } from 'next/server'
import { toFile } from 'openai'
import { authenticateRequest } from '@/lib/middleware'
import { getOpenAIForAudio, TRANSCRIBE_MODEL, voiceInputConfigured } from '@/lib/ai/config'

// Short audio clips transcribe quickly, but give some headroom.
export const maxDuration = 60

/**
 * Transcribe a voice note to text (OpenAI Whisper). The panel records a short
 * clip, posts it here, and drops the returned text into the composer so the
 * user can review/edit before sending it to the assistant.
 */
export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  if (!voiceInputConfigured()) {
    return NextResponse.json(
      {
        error: 'not_configured',
        message:
          'Voice notes are not set up yet. An administrator needs to add an OPENAI_API_KEY to the server.',
      },
      { status: 503 }
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with an "audio" file' }, { status: 400 })
  }

  const audio = form.get('audio')
  if (!audio || typeof audio === 'string') {
    return NextResponse.json({ error: 'Missing "audio" file' }, { status: 400 })
  }

  const file = audio as File
  // Guard against oversized uploads (~25MB is OpenAI's limit; keep well under).
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty audio' }, { status: 400 })
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'Audio is too long. Please keep voice notes short.' }, { status: 413 })
  }

  try {
    const openai = getOpenAIForAudio()
    if (!openai) {
      return NextResponse.json({ error: 'not_configured' }, { status: 503 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const uploadable = await toFile(buffer, file.name || 'voice-note.webm', {
      type: file.type || 'audio/webm',
    })
    const result = await openai.audio.transcriptions.create({
      file: uploadable,
      model: TRANSCRIBE_MODEL,
    })
    const text = (result as any)?.text ?? ''
    return NextResponse.json({ text })
  } catch (error: any) {
    console.error('Transcription error:', error)
    return NextResponse.json(
      { error: 'transcription_failed', message: String(error?.message ?? 'Could not transcribe audio') },
      { status: 500 }
    )
  }
}
