import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

/**
 * Central config for the AI assistant.
 *
 * Keys are read from the environment and never shipped to the client:
 *  - ANTHROPIC_API_KEY  → the assistant (Claude). Required.
 *  - OPENAI_API_KEY     → image generation only (Claude can't make images).
 *                         Optional: the generate_image tool degrades gracefully
 *                         when it's missing.
 */
export const ANTHROPIC_MODEL = 'claude-opus-5-5'
export const IMAGE_MODEL = 'gpt-image-1'

export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  return new Anthropic({ apiKey })
}

export function getOpenAIForImages(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

export function assistantConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

export function imageGenConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY
}
