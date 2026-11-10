import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { assistantConfigured, imageGenConfigured } from '@/lib/ai/config'
import { runAssistant } from '@/lib/ai/assistant'
import type { ToolContext } from '@/lib/ai/tools'

// Chat turns can run a multi-step tool loop; give it room.
export const maxDuration = 120

/** Lightweight capability probe so the launcher only shows when configured. */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  return NextResponse.json({
    configured: assistantConfigured(),
    imageGeneration: imageGenConfigured(),
  })
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  if (!assistantConfigured()) {
    return NextResponse.json(
      {
        error: 'not_configured',
        message:
          'The AI assistant is not set up yet. An administrator needs to add an ANTHROPIC_API_KEY to the server.',
      },
      { status: 503 }
    )
  }

  const user = getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const messages = Array.isArray(body?.messages)
    ? (body.messages as Anthropic.MessageParam[])
    : null
  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: 'messages[] is required' }, { status: 400 })
  }

  // Forward the caller's own bearer token to the tool layer so every Trimpro
  // route the assistant touches enforces this user's permissions.
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 })

  const ctx: ToolContext = {
    baseUrl: new URL(request.url).origin,
    token,
    pendingConfirmations: [],
    images: [],
  }

  try {
    const result = await runAssistant(messages, ctx)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('AI assistant error:', error)
    return NextResponse.json(
      { error: 'assistant_error', message: String(error?.message ?? 'Internal error') },
      { status: 500 }
    )
  }
}
