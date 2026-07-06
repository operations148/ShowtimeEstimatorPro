export interface SendSmsParams {
  to: string;
  body: string;
  from?: string;
}

/**
 * SMS provider interface.
 * Implement this to plug in any SMS vendor (Twilio, Vonage, AWS SNS, etc.).
 */
export interface SmsProvider {
  send(params: SendSmsParams): Promise<{ messageId: string }>;
}
