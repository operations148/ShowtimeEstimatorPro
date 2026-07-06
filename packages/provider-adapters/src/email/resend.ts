import type { EmailProvider, SendEmailParams } from './interface';

/**
 * Resend email provider (https://resend.com)
 * Free tier: 3,000 emails/month, 100/day — no credit card required.
 *
 * Setup:
 *   1. Sign up at https://resend.com
 *   2. Add and verify your sending domain (or use onboarding@resend.dev for testing)
 *   3. Create an API key
 *   4. Set RESEND_API_KEY and RESEND_FROM in apps/api/.env
 */
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(params: SendEmailParams): Promise<{ messageId: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.from ?? this.from,
        to: [params.to],
        subject: params.subject,
        text: params.textBody,
        ...(params.htmlBody ? { html: params.htmlBody } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { id: string };
    return { messageId: data.id };
  }
}
