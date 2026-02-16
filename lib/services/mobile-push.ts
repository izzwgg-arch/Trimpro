import { prisma } from '@/lib/prisma'

type PushPayload = {
  title: string
  body?: string | null
  data?: Record<string, any>
}

type MobilePushTokenRecord = {
  token: string
  platform?: string
  updatedAt?: string
}

function getUserPushTokens(permissions: unknown): string[] {
  if (!permissions || typeof permissions !== 'object') return []
  const mobilePushTokens = (permissions as Record<string, any>).mobilePushTokens
  if (!Array.isArray(mobilePushTokens)) return []

  return mobilePushTokens
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as MobilePushTokenRecord
      return typeof record.token === 'string' ? record.token.trim() : null
    })
    .filter((token): token is string => Boolean(token && token.startsWith('ExponentPushToken[')))
}

async function sendExpoPushMessages(messages: Array<Record<string, any>>) {
  if (messages.length === 0) return
  const chunks: Array<Array<Record<string, any>>> = []
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100))
  }

  for (const chunk of chunks) {
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      })
    } catch (error) {
      console.error('Expo push send failed:', error)
    }
  }
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { permissions: true },
    })
    if (!user) return

    const tokens = getUserPushTokens(user.permissions)
    if (tokens.length === 0) return

    const messages = tokens.map((token) => ({
      to: token,
      sound: 'default',
      title: payload.title,
      body: payload.body || undefined,
      data: payload.data || {},
    }))

    await sendExpoPushMessages(messages)
  } catch (error) {
    console.error('sendPushToUser error:', error)
  }
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  if (userIds.length === 0) return
  try {
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        permissions: true,
      },
    })

    const messages: Array<Record<string, any>> = []
    for (const user of users) {
      const tokens = getUserPushTokens(user.permissions)
      for (const token of tokens) {
        messages.push({
          to: token,
          sound: 'default',
          title: payload.title,
          body: payload.body || undefined,
          data: payload.data || {},
        })
      }
    }

    await sendExpoPushMessages(messages)
  } catch (error) {
    console.error('sendPushToUsers error:', error)
  }
}

