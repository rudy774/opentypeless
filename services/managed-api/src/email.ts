import type { ServiceConfig } from './config.js'

interface EmailMessage {
  to: string
  subject: string
  heading: string
  actionLabel: string
  actionUrl: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function sendTransactionalEmail(
  config: ServiceConfig,
  message: EmailMessage,
): Promise<void> {
  if (!config.resendApiKey || !config.mailFrom) {
    throw new Error('Email delivery is not configured')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.mailFrom,
        to: [message.to],
        subject: message.subject,
        html: `<main><h1>${escapeHtml(message.heading)}</h1><p><a href="${escapeHtml(
          message.actionUrl,
        )}">${escapeHtml(message.actionLabel)}</a></p><p>This link expires automatically.</p></main>`,
      }),
    })
    if (!response.ok) throw new Error('Email delivery failed')
  } catch {
    throw new Error('Email delivery failed')
  } finally {
    clearTimeout(timeout)
  }
}
export async function sendAccountExportEmail(
  config: ServiceConfig,
  recipient: string,
  downloadUrl: string,
  idempotencyKey: string,
): Promise<void> {
  if (!config.resendApiKey || !config.mailFrom) throw new Error('Email delivery is not configured')
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: config.mailFrom,
        to: [recipient],
        subject: 'Your OpenTypeless account export',
        html: `<main><h1>Your account export</h1><p><a href="${escapeHtml(downloadUrl)}">Download your export</a></p><p>This one-time link expires in 30 minutes.</p></main>`,
      }),
    })
    if (!response.ok) throw new Error('Email delivery failed')
  } catch {
    throw new Error('Email delivery failed')
  }
}
