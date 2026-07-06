import type { SmsProvider } from './interface';
import { MockSmsProvider } from './mock';

export function createSmsProvider(providerName: string): SmsProvider {
  switch (providerName) {
    case 'mock':
      return new MockSmsProvider();

    // case 'twilio':
    //   return new TwilioSmsProvider(process.env.TWILIO_SID!, process.env.TWILIO_AUTH_TOKEN!);
    // case 'vonage':
    //   return new VonageSmsProvider(process.env.VONAGE_API_KEY!, process.env.VONAGE_API_SECRET!);

    default:
      console.warn(`Unknown SMS provider "${providerName}", falling back to mock.`);
      return new MockSmsProvider();
  }
}
