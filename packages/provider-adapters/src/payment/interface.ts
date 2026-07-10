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
  /** Provider event id, used for idempotent processing (dedupe). */
  id?: string;
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
  /**
   * Whether constructWebhookEvent cryptographically verifies the request signature.
   * Providers that do NOT verify (e.g. the mock) must never process webhooks in
   * production — the webhook route enforces this to avoid an unauthenticated write.
   */
  readonly verifiesSignatures: boolean;
  createCheckoutSession(params: CreateSubscriptionParams): Promise<{ url: string }>;
  getSubscription(externalId: string): Promise<SubscriptionInfo>;
  constructWebhookEvent(rawBody: string, signature: string): Promise<WebhookEvent>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
}
