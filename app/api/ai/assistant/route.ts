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

  // The tool layer calls Trimpro's own routes server-to-server. Go straight to
  // loopback rather than new URL(request.url).origin: behind a proxy that origin
  // is the public HTTPS host, which the server often can't call back into
  // (DNS/SSL/proxy loop) — causing "connection error" in production.
  const internalBaseUrl =
    process.env.AI_INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`

  const ctx: ToolContext = {
    baseUrl: internalBaseUrl,
    token,
    pendingConfirmations: [],
    images: [],
    navigation: null,
  }

  // The panel tells us which record the user currently has open, so "add this to
  // the estimate/invoice" resolves to the right document without the user pasting an id.
  const context = body?.context || {}
  const noteParts: string[] = []
  if (context.openEstimateId) {
    noteParts.push(`The user currently has estimate ${context.openEstimateId} open. If they ask to add items to "the estimate" / "this estimate", use add_estimate_items with estimateId "${context.openEstimateId}".`)
  }
  if (context.openInvoiceId) {
    noteParts.push(`The user currently has invoice ${context.openInvoiceId} open. If they ask to add items to "the invoice" / "this invoice", use add_invoice_items with invoiceId "${context.openInvoiceId}".`)
  }
  const contextNote = noteParts.length ? noteParts.join('\n') : undefined

  try {
    const result = await runAssistant(messages, ctx, contextNote)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('AI assistant error:', error)
    return NextResponse.json(
      { error: 'assistant_error', message: String(error?.message ?? 'Internal error') },
      { status: 500 }
    )
  }
}
