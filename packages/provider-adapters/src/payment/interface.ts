export interface CreateSubscriptionParams {
  tenantId: string;
  email: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface SubscriptionInfo {
  externalId: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid';
  currentPeriodEnd: Date;
}

export interface WebhookEvent {
  type: string;
  data: {
    subscriptionId: string;
    status: string;
    currentPeriodEnd: string;
    /** Present on subscription.created events — identifies the owning tenant. */
    tenantId?: string;
    /** Present on subscription.created events — the plan that was purchased. */
    planId?: string;
  };
}

/**
 * Payment provider interface.
 * Implement this for Stripe, Paddle, LemonSqueezy, etc.
 */
export interface PaymentProvider {
  createCheckoutSession(params: CreateSubscriptionParams): Promise<{ url: string }>;
  getSubscription(externalId: string): Promise<SubscriptionInfo>;
  constructWebhookEvent(rawBody: string, signature: string): Promise<WebhookEvent>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
}
