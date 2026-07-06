import type { EmailProvider } from './interface';
import { MockEmailProvider } from './mock';
import { ResendEmailProvider } from './resend';

/**
 * Factory to create the configured email provider.
 * Add new providers here as `case` branches.
 */
export function createEmailProvider(providerName: string): EmailProvider {
  switch (providerName) {
    case 'mock':
      return new MockEmailProvider();

    case 'resend': {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM ?? 'onboarding@resend.dev';
      if (!apiKey) throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
      return new ResendEmailProvider(apiKey, from);
    }

    // case 'sendgrid':
    //   return new SendGridEmailProvider(process.env.SENDGRID_API_KEY!);
    // case 'postmark':
    //   return new PostmarkEmailProvider(process.env.POSTMARK_API_KEY!);
    // case 'ses':
    //   return new SesEmailProvider({ region: process.env.AWS_REGION! });

    default:
      console.warn(`Unknown email provider "${providerName}", falling back to mock.`);
      return new MockEmailProvider();
  }
}
