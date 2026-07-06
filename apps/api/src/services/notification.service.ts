import type { EmailProvider } from '@repo/provider-adapters';
import type { LeadNotificationPayload, NotificationRecipient } from '@repo/shared';
import {
  renderTemplate,
  LEAD_NOTIFICATION_SUBJECT_TEMPLATE,
  LEAD_NOTIFICATION_BODY_TEMPLATE,
} from './template.service';

export class NotificationService {
  constructor(private emailProvider: EmailProvider) {}

  /**
   * Send a new-lead notification to tenant-configured recipients.
   */
  async notifyNewLead(
    recipients: NotificationRecipient[],
    payload: LeadNotificationPayload,
  ): Promise<void> {
    const phoneLinePart = payload.lead.phone ? `Phone: ${payload.lead.phone}\n` : '';

    const vars: Record<string, string> = {
      ESTIMATOR_TITLE: payload.estimatorTitle,
      LEAD_NAME: payload.lead.name ?? payload.lead.email,
      LEAD_EMAIL: payload.lead.email,
      LEAD_ZIP: payload.lead.zip ?? '',
      LEAD_PHONE_LINE: phoneLinePart,
      ESTIMATE_MIN: formatCurrency(payload.estimateMin, payload.currency),
      ESTIMATE_MAX: formatCurrency(payload.estimateMax, payload.currency),
      SUBMITTED_AT: payload.submittedAt.toISOString(),
    };

    const subject = renderTemplate(LEAD_NOTIFICATION_SUBJECT_TEMPLATE, vars);
    const body = renderTemplate(LEAD_NOTIFICATION_BODY_TEMPLATE, vars);

    await Promise.all(
      recipients.map((r) =>
        this.emailProvider.send({
          to: r.email,
          subject,
          textBody: body,
        }),
      ),
    );
  }
}

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
