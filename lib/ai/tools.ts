import type Anthropic from '@anthropic-ai/sdk'
import { getOpenAIForImages, IMAGE_MODEL } from './config'

/**
 * The assistant's tools are thin wrappers around Trimpro's own HTTP routes,
 * called with the signed-in user's bearer token. This means:
 *   - all existing permission checks run exactly as they do for the UI, and
 *   - the assistant can never do more than that user is allowed to do.
 *
 * Sending an estimate is deliberately NOT executed by the model. prepare_send_estimate
 * only gathers the details and queues a confirmation; the actual send happens when the
 * user clicks "Send" in the panel (which calls the real /api/estimates/[id]/send route).
 */
export interface PendingConfirmation {
  type: 'send_estimate'
  estimateId: string
  estimateNumber?: string | null
  recipient?: string | null
  total?: string | null
}

export interface GeneratedImage {
  url: string
  prompt: string
}

export interface ToolContext {
  baseUrl: string
  token: string
  pendingConfirmations: PendingConfirmation[]
  images: GeneratedImage[]
}

type ToolResult = { content: string; isError?: boolean }

async function api(
  ctx: ToolContext,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON response */
  }
  return { ok: res.ok, status: res.status, json, text }
}

function permissionError(status: number, json: any): ToolResult | null {
  if (status === 401 || status === 403) {
    return {
      content: JSON.stringify({
        error: 'permission_denied',
        message:
          json?.error ||
          "You don't have permission to do this in Trimpro, so the assistant can't either.",
      }),
      isError: true,
    }
  }
  return null
}

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'find_customer',
    description:
      'Search the customer (client) list by name, company, email or phone. Use this to resolve a customer to a clientId before creating or sending an estimate. Returns up to 10 matches.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, company, email or phone to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_estimate',
    description:
      'Create a new estimate (saved as a DRAFT). You must have a clientId (use find_customer first) and a title. Line items each have a description, quantity and unitPrice. Totals are computed by the server — do not provide them. The estimate is NOT sent to the customer.',
    input_schema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'The client/customer id from find_customer.' },
        title: { type: 'string', description: 'A short title for the estimate.' },
        lineItems: {
          type: 'array',
          description: 'The line items.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number', description: 'Price per unit, in dollars.' },
            },
            required: ['description', 'quantity', 'unitPrice'],
          },
        },
        taxRate: { type: 'number', description: 'Tax rate percent, e.g. 8.875. Optional.' },
        discount: { type: 'number', description: 'Flat discount amount in dollars. Optional.' },
        jobType: { type: 'string', description: 'Optional job type label.' },
        notes: { type: 'string', description: 'Optional internal notes.' },
      },
      required: ['clientId', 'title', 'lineItems'],
    },
  },
  {
    name: 'prepare_send_estimate',
    description:
      'Prepare to send an existing estimate to the customer. This does NOT send it — it gathers the recipient and total and asks the user to confirm. The user must click Send in the panel to actually send. Call this when the user asks to send/email an estimate.',
    input_schema: {
      type: 'object',
      properties: {
        estimateId: { type: 'string', description: 'The estimate id to send.' },
        recipientEmail: {
          type: 'string',
          description: "Optional recipient email. If omitted, the customer's email on file is used.",
        },
      },
      required: ['estimateId'],
    },
  },
  {
    name: 'schedule_job',
    description:
      "Set a job's scheduled start (and optionally end) date/time. Dates must be ISO 8601 (e.g. 2026-11-15T09:00:00). If there's a crew conflict it returns a conflict unless force is true.",
    input_schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job id to schedule.' },
        scheduledStart: { type: 'string', description: 'ISO 8601 start datetime.' },
        scheduledEnd: { type: 'string', description: 'ISO 8601 end datetime. Optional (defaults to start + 1 hour).' },
        force: { type: 'boolean', description: 'Set true to schedule despite a crew conflict.' },
      },
      required: ['jobId', 'scheduledStart'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate a concept/marketing image from a text prompt (e.g. a railing or closet style to show a customer). The image is shown to the user in the panel. Use for concepts only — not accurate, to-scale product renderings.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to depict.' },
      },
      required: ['prompt'],
    },
  },
]

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const input = (rawInput ?? {}) as Record<string, any>
  try {
    switch (name) {
      case 'find_customer': {
        const q = String(input.query ?? '').trim()
        if (!q) return { content: JSON.stringify({ error: 'query is required' }), isError: true }
        const { ok, status, json } = await api(
          ctx,
          'GET',
          `/api/clients?search=${encodeURIComponent(q)}&limit=10`
        )
        const permErr = permissionError(status, json)
        if (permErr) return permErr
        if (!ok) return { content: JSON.stringify({ error: 'lookup_failed', status }), isError: true }
        const clients = (json?.clients ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          companyName: c.companyName ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
        }))
        return { content: JSON.stringify({ count: clients.length, clients }) }
      }

      case 'create_estimate': {
        const clientId = String(input.clientId ?? '').trim()
        const title = String(input.title ?? '').trim()
        if (!clientId) return { content: JSON.stringify({ error: 'clientId is required' }), isError: true }
        if (!title) return { content: JSON.stringify({ error: 'title is required' }), isError: true }
        const lineItems = Array.isArray(input.lineItems)
          ? input.lineItems.map((li: any) => ({
              description: String(li?.description ?? ''),
              quantity: Number(li?.quantity ?? 0),
              unitPrice: Number(li?.unitPrice ?? 0),
            }))
          : []
        const body: Record<string, any> = { clientId, title, lineItems }
        if (input.taxRate != null) body.taxRate = Number(input.taxRate)
        if (input.discount != null) body.discount = Number(input.discount)
        if (input.jobType) body.jobType = String(input.jobType)
        if (input.notes) body.notes = String(input.notes)
        const { ok, status, json } = await api(ctx, 'POST', '/api/estimates', body)
        const permErr = permissionError(status, json)
        if (permErr) return permErr
        if (!ok) {
          return {
            content: JSON.stringify({ error: 'create_failed', status, detail: json?.error ?? null }),
            isError: true,
          }
        }
        const est = json?.estimate ?? {}
        return {
          content: JSON.stringify({
            created: true,
            estimateId: est.id,
            estimateNumber: est.estimateNumber ?? null,
            total: est.total != null ? String(est.total) : null,
            status: est.status ?? 'DRAFT',
          }),
        }
      }

      case 'prepare_send_estimate': {
        const estimateId = String(input.estimateId ?? '').trim()
        if (!estimateId) return { content: JSON.stringify({ error: 'estimateId is required' }), isError: true }
        // Best-effort fetch of details for the confirmation card (don't fail if it 404s).
        let estimateNumber: string | null = null
        let total: string | null = null
        let recipient: string | null = input.recipientEmail ? String(input.recipientEmail) : null
        const { ok, json } = await api(ctx, 'GET', `/api/estimates/${encodeURIComponent(estimateId)}`)
        if (ok && json) {
          const est = json.estimate ?? json
          estimateNumber = est?.estimateNumber ?? null
          total = est?.total != null ? String(est.total) : null
          if (!recipient) recipient = est?.client?.email ?? null
        }
        ctx.pendingConfirmations.push({
          type: 'send_estimate',
          estimateId,
          estimateNumber,
          recipient,
          total,
        })
        return {
          content: JSON.stringify({
            prepared: true,
            awaiting_user_confirmation: true,
            estimateNumber,
            recipient: recipient ?? "the customer's email on file",
            note:
              'A confirmation with a Send button is now shown to the user. Tell the user it is ready and ask them to click Send. Do NOT claim it has been sent.',
          }),
        }
      }

      case 'schedule_job': {
        const jobId = String(input.jobId ?? '').trim()
        const scheduledStart = String(input.scheduledStart ?? '').trim()
        if (!jobId) return { content: JSON.stringify({ error: 'jobId is required' }), isError: true }
        if (!scheduledStart) return { content: JSON.stringify({ error: 'scheduledStart is required' }), isError: true }
        const body: Record<string, any> = { scheduledStart }
        if (input.scheduledEnd) body.scheduledEnd = String(input.scheduledEnd)
        if (input.force) body.force = true
        const { ok, status, json } = await api(
          ctx,
          'PATCH',
          `/api/jobs/${encodeURIComponent(jobId)}/schedule`,
          body
        )
        const permErr = permissionError(status, json)
        if (permErr) return permErr
        if (status === 409) {
          return {
            content: JSON.stringify({
              error: 'schedule_conflict',
              message:
                'There is a crew scheduling conflict. Ask the user if they want to schedule anyway (then call again with force: true).',
            }),
          }
        }
        if (!ok) {
          return {
            content: JSON.stringify({ error: 'schedule_failed', status, detail: json?.error ?? null }),
            isError: true,
          }
        }
        return { content: JSON.stringify({ scheduled: true, jobId, scheduledStart, scheduledEnd: body.scheduledEnd ?? null }) }
      }

      case 'generate_image': {
        const prompt = String(input.prompt ?? '').trim()
        if (!prompt) return { content: JSON.stringify({ error: 'prompt is required' }), isError: true }
        const openai = getOpenAIForImages()
        if (!openai) {
          return {
            content: JSON.stringify({
              error: 'image_generation_unavailable',
              message:
                'Image generation is not configured (no OPENAI_API_KEY). Tell the user image generation needs to be set up.',
            }),
            isError: true,
          }
        }
        const result = await openai.images.generate({
          model: IMAGE_MODEL,
          prompt,
          size: '1024x1024',
          n: 1,
        })
        const b64 = result.data?.[0]?.b64_json
        if (!b64) {
          return { content: JSON.stringify({ error: 'image_generation_failed' }), isError: true }
        }
        const buffer = Buffer.from(b64, 'base64')
        const form = new FormData()
        form.append('file', new Blob([buffer], { type: 'image/png' }), `ai-image-${Date.now()}.png`)
        const uploadRes = await fetch(`${ctx.baseUrl}/api/uploads`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ctx.token}` },
          body: form,
        })
        const uploadJson: any = await uploadRes.json().catch(() => null)
        if (!uploadRes.ok || !uploadJson?.url) {
          const permErr = permissionError(uploadRes.status, uploadJson)
          if (permErr) return permErr
          return { content: JSON.stringify({ error: 'image_upload_failed', status: uploadRes.status }), isError: true }
        }
        ctx.images.push({ url: uploadJson.url, prompt })
        return {
          content: JSON.stringify({
            generated: true,
            imageUrl: uploadJson.url,
            note: 'The image is displayed to the user in the panel.',
          }),
        }
      }

      default:
        return { content: JSON.stringify({ error: `unknown tool: ${name}` }), isError: true }
    }
  } catch (err: any) {
    return {
      content: JSON.stringify({ error: 'tool_exception', message: String(err?.message ?? err) }),
      isError: true,
    }
  }
}
