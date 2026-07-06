import type { PaymentProvider } from './interface';
import { MockPaymentProvider } from './mock';

export function createPaymentProvider(providerName: string): PaymentProvider {
  switch (providerName) {
    case 'mock':
      return new MockPaymentProvider();

    // case 'stripe':
    //   return new StripePaymentProvider(process.env.STRIPE_SECRET_KEY!);

    default:
      console.warn(`Unknown payment provider "${providerName}", falling back to mock.`);
      return new MockPaymentProvider();
  }
}
