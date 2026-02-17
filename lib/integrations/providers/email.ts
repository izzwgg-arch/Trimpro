/**
 * Email Provider Integration
 * Supports SendGrid, Mailgun, Resend, Google (Gmail SMTP)
 */

import { IntegrationTestResult } from '../types'

function getFromName(secrets: Record<string, any>) {
  return String(secrets.fromName || secrets.senderName || secrets.brandName || 'TrimPro').trim() || 'TrimPro'
}

function getFromEmail(secrets: Record<string, any>, fallback: string) {
  return String(secrets.fromEmail || secrets.emailFrom || secrets.senderEmail || fallback).trim() || fallback
}

function formatFromHeader(name: string, email: string) {
  // RFC 5322 friendly display-name format used by most providers.
  return `${name} <${email}>`
}

export async function testEmailProvider(
  secrets: Record<string, any>,
  to: string,
  subject: string,
  html: string
): Promise<IntegrationTestResult> {
  try {
    const provider = secrets.provider || 'resend'
    let result: any

    switch (provider) {
      case 'sendgrid':
        result = await testSendGrid(secrets, to, subject, html)
        break
      case 'mailgun':
        result = await testMailgun(secrets, to, subject, html)
        break
      case 'google':
        result = await testGoogle(secrets, to, subject, html)
        break
      case 'resend':
      default:
        result = await testResend(secrets, to, subject, html)
        break
    }

    return result
  } catch (error: any) {
    return {
      success: false,
      message: 'Email test failed',
      error: error.message || 'Unknown error',
    }
  }
}

async function testSendGrid(
  secrets: Record<string, any>,
  to: string,
  subject: string,
  html: string
): Promise<IntegrationTestResult> {
  const apiKey = secrets.apiKey
  if (!apiKey) {
    return { success: false, message: 'SendGrid API key not configured', error: 'Missing apiKey' }
  }

  try {
    const fromName = getFromName(secrets)
    const fromEmail = getFromEmail(secrets, 'noreply@trimpro.com')
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: fromName },
        subject,
        content: [{ type: 'text/html', value: html }],
        reply_to: secrets.replyTo ? { email: secrets.replyTo } : undefined,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        message: 'SendGrid test failed',
        error: `SendGrid API error: ${response.status} - ${errorText}`,
      }
    }

    return {
      success: true,
      message: `Test email sent successfully to ${to} via SendGrid`,
    }
  } catch (error: any) {
    return {
      success: false,
      message: 'SendGrid test failed',
      error: error.message || 'Unknown error',
    }
  }
}

async function testMailgun(
  secrets: Record<string, any>,
  to: string,
  subject: string,
  html: string
): Promise<IntegrationTestResult> {
  const apiKey = secrets.apiKey
  const domain = secrets.mailgunDomain
  if (!apiKey || !domain) {
    return {
      success: false,
      message: 'Mailgun API key or domain not configured',
      error: 'Missing apiKey or mailgunDomain',
    }
  }

  const region = secrets.mailgunRegion || 'us'
  const apiBase = region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'

  try {
    const fromName = getFromName(secrets)
    const fromEmail = getFromEmail(secrets, `noreply@${domain}`)
    const formData = new URLSearchParams()
    formData.append('from', formatFromHeader(fromName, fromEmail))
    formData.append('to', to)
    formData.append('subject', subject)
    formData.append('html', html)
    if (secrets.replyTo) {
      formData.append('h:Reply-To', secrets.replyTo)
    }

    const response = await fetch(`${apiBase}/v3/${domain}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        message: 'Mailgun test failed',
        error: `Mailgun API error: ${response.status} - ${errorText}`,
      }
    }

    return {
      success: true,
      message: `Test email sent successfully to ${to} via Mailgun`,
    }
  } catch (error: any) {
    return {
      success: false,
      message: 'Mailgun test failed',
      error: error.message || 'Unknown error',
    }
  }
}

async function testResend(
  secrets: Record<string, any>,
  to: string,
  subject: string,
  html: string
): Promise<IntegrationTestResult> {
  const apiKey = secrets.apiKey
  if (!apiKey) {
    return { success: false, message: 'Resend API key not configured', error: 'Missing apiKey' }
  }

  try {
    const fromName = getFromName(secrets)
    const fromEmail = getFromEmail(secrets, 'noreply@trimpro.com')
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: formatFromHeader(fromName, fromEmail),
        to: [to],
        subject,
        html,
        reply_to: secrets.replyTo,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      return {
        success: false,
        message: 'Resend test failed',
        error: error.message || `Resend API error: ${response.status}`,
      }
    }

    const data = await response.json()
    return {
      success: true,
      message: `Test email sent successfully to ${to} via Resend`,
    }
  } catch (error: any) {
    return {
      success: false,
      message: 'Resend test failed',
      error: error.message || 'Unknown error',
    }
  }
}

async function testGoogle(
  secrets: Record<string, any>,
  to: string,
  subject: string,
  html: string
): Promise<IntegrationTestResult> {
  const user = (secrets.googleEmail || secrets.fromEmail || '').trim()
  const pass = (secrets.googleAppPassword || '').trim()

  if (!user || !pass) {
    return {
      success: false,
      message: 'Google email credentials not configured',
      error: 'Missing googleEmail or googleAppPassword',
    }
  }

  try {
    const nodemailer = await import('nodemailer')
    const fromName = getFromName(secrets)
    const fromEmail = getFromEmail(secrets, user)
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user,
        pass,
      },
    })

    await transporter.sendMail({
      from: formatFromHeader(fromName, fromEmail),
      to,
      subject,
      html,
      replyTo: secrets.replyTo || undefined,
    })

    return {
      success: true,
      message: `Test email sent successfully to ${to} via Google`,
    }
  } catch (error: any) {
    return {
      success: false,
      message: 'Google email test failed',
      error: error.message || 'Unknown error',
    }
  }
}
