import type { SmsProvider, SendSmsParams } from './interface';

export class MockSmsProvider implements SmsProvider {
  public sentMessages: SendSmsParams[] = [];

  async send(params: SendSmsParams): Promise<{ messageId: string }> {
    const messageId = `mock_sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.sentMessages.push(params);
    if (process.env['NODE_ENV'] !== 'production') {
      console.log(`[MockSMS] To: ${params.to} | Body: ${params.body}`);
    }
    return { messageId };
  }
}
