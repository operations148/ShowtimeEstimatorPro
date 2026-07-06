import type {
  PaymentProvider,
  CreateSubscriptionParams,
  SubscriptionInfo,
  WebhookEvent,
} from './interface';

export class MockPaymentProvider implements PaymentProvider {
  private subscriptions = new Map<string, SubscriptionInfo>();

  async createCheckoutSession(params: CreateSubscriptionParams): Promise<{ url: string }> {
    const externalId = `mock_sub_${Date.now()}`;
    this.subscriptions.set(externalId, {
      externalId,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    if (process.env['NODE_ENV'] !== 'production') {
      console.log(`[MockPayment] Checkout created for tenant ${params.tenantId}, sub: ${externalId}`);
    }
    return { url: `${params.successUrl}?session_id=${externalId}` };
  }

  async getSubscription(externalId: string): Promise<SubscriptionInfo> {
    const sub = this.subscriptions.get(externalId);
    if (!sub) {
      return {
        externalId,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
    }
    return sub;
  }

  async constructWebhookEvent(rawBody: string, _signature: string): Promise<WebhookEvent> {
    return JSON.parse(rawBody) as WebhookEvent;
  }

  async createPortalSession(_customerId: string, returnUrl: string): Promise<{ url: string }> {
    return { url: returnUrl };
  }
}
