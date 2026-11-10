import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, ANTHROPIC_MODEL } from './config'
import { TOOL_DEFS, executeTool, type ToolContext, type PendingConfirmation, type GeneratedImage } from './tools'

const SYSTEM_PROMPT = `You are the Trimpro Assistant, an AI helper inside the Trimpro field-service app for a trim-carpentry / railings / closets business. You help office staff get things done by using tools.

What you can do via tools:
- find_customer: look up a customer to get their clientId.
- create_estimate: create a DRAFT estimate for a customer (never sends it).
- prepare_send_estimate: prepare to send an estimate — this only queues a confirmation; the user must click Send.
- schedule_job: set a job's scheduled date/time.
- generate_image: make a concept/marketing image to show a customer.

Rules:
- To create or send an estimate you need the customer's clientId — call find_customer first if you only have a name. If several customers match, ask the user which one.
- Amounts are US dollars.
- NEVER say you have sent an estimate. Sending requires the user to click the Send button that appears after prepare_send_estimate. After calling it, tell the user it's ready and ask them to confirm.
- Before creating an estimate, make sure you have the title and line items. If key details are missing, ask a brief question.
- Generated images are concepts only, not to-scale renderings — say so when you show one.
- If a tool reports permission_denied, tell the user they don't have permission for that action in Trimpro.
- Be concise and friendly. Confirm what you did, including estimate numbers and totals.`

export interface AssistantResult {
  messages: Anthropic.MessageParam[]
  reply: string
  pendingConfirmations: PendingConfirmation[]
  images: GeneratedImage[]
}

const MAX_ITERATIONS = 8

/** Remove thinking blocks from assistant turns before persisting/returning, so the
 *  client never has to round-trip signed thinking blocks across requests. */
function stripThinking(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return m
    const content = m.content.filter(
      (b: any) => b.type !== 'thinking' && b.type !== 'redacted_thinking'
    )
    return { ...m, content }
  })
}

function lastAssistantText(messages: Anthropic.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      const text = m.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim()
      if (text) return text
    }
    break
  }
  return ''
}

/**
 * Run the assistant's agentic loop for one user turn.
 * `inputMessages` is the full prior conversation (from the client) plus the new user message.
 */
export async function runAssistant(
  inputMessages: Anthropic.MessageParam[],
  ctx: ToolContext
): Promise<AssistantResult> {
  const client = getAnthropic()
  if (!client) throw new Error('ANTHROPIC_API_KEY is not configured')

  const messages: Anthropic.MessageParam[] = [...inputMessages]

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason !== 'tool_use') break

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )
    if (toolUses.length === 0) break

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const { content, isError } = await executeTool(tu.name, tu.input, ctx)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content,
        ...(isError ? { is_error: true } : {}),
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  const clean = stripThinking(messages)
  return {
    messages: clean,
    reply: lastAssistantText(clean) || "Sorry — I couldn't complete that. Please try rephrasing.",
    pendingConfirmations: ctx.pendingConfirmations,
    images: ctx.images,
  }
}
