export function createWidgetApi(baseUrl: string) {
  async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.data as T;
  }

  return {
    getConfig: (publicKey: string) =>
      request<{
        estimatorId: string;
        publicKey: string;
        title: string;
        branding: { logoUrl?: string; primaryColor?: string; fontFamily?: string };
        questions: any[];
        tenantName: string;
        serviceAreaBehavior: 'block' | 'warn';
        leadConfig: { required: string[]; optional: string[] };
      }>(`/widget/${publicKey}`),

    submit: (body: {
      estimatorPublicKey: string;
      lead: { name: string; phone: string; email: string; zip?: string };
      answers: Record<string, unknown>;
      sessionId: string;
      company?: string; // honeypot — always empty for real users
    }) =>
      request<{
        submissionId: string;
        estimate: { min: number; max: number; currency: string };
      }>('/submissions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    trackEvent: (body: {
      tenantId?: string;
      estimatorId: string;
      eventType: string;
      stepId?: string;
      sessionId: string;
    }) =>
      request<{ tracked: boolean }>('/analytics/events', {
        method: 'POST',
        body: JSON.stringify(body),
      }).catch(() => {}), // Fire-and-forget
  };
}
