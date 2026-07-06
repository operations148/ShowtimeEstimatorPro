import type { EmailProvider, SendEmailParams } from './interface';

export class MockEmailProvider implements EmailProvider {
  public sentEmails: SendEmailParams[] = [];

  async send(params: SendEmailParams): Promise<{ messageId: string }> {
    const messageId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.sentEmails.push(params);
    if (process.env['NODE_ENV'] !== 'production') {
      console.log(`[MockEmail] To: ${params.to} | Subject: ${params.subject}`);
      console.log(`[MockEmail] Body: ${params.textBody}`);
    }
    return { messageId };
  }
}
