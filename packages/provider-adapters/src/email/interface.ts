export interface SendEmailParams {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  from?: string;
}

/**
 * Email provider interface.
 * Implement this to plug in any transactional email vendor
 * (SendGrid, Postmark, AWS SES, Mailgun, etc.).
 */
export interface EmailProvider {
  send(params: SendEmailParams): Promise<{ messageId: string }>;
}
