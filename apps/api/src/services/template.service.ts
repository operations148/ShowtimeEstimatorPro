/**
 * Lightweight template renderer.
 *
 * Templates use {{PLACEHOLDER}} syntax. Any key in `vars` whose name matches
 * a placeholder (case-sensitive) is substituted. Unknown placeholders are left
 * as-is so callers can detect missing values during testing.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match;
  });
}

// ── Default OTP templates (mirrors attachments/otp-*-template.sample.txt) ────

export const OTP_EMAIL_SUBJECT = 'Your sign-in code';

export const OTP_EMAIL_TEMPLATE = `Your one-time code is: {{CODE}}
This code expires in {{MINUTES}} minutes.`;

export const OTP_SMS_TEMPLATE = `Your sign-in code is {{CODE}}. Expires in {{MINUTES}} minutes.`;

// ── Lead notification template ────────────────────────────────────────────────
//
// Vars: ESTIMATOR_TITLE, LEAD_NAME, LEAD_EMAIL, LEAD_ZIP,
//       LEAD_PHONE_LINE (pre-formatted line or empty string),
//       ESTIMATE_MIN, ESTIMATE_MAX, SUBMITTED_AT
//
// Note: LEAD_PHONE_LINE must already include a trailing newline when populated,
// or be an empty string when there is no phone number.

export const LEAD_NOTIFICATION_SUBJECT_TEMPLATE = `New estimate submission: {{ESTIMATOR_TITLE}}`;

export const LEAD_NOTIFICATION_BODY_TEMPLATE = `New lead from {{LEAD_NAME}}
Email: {{LEAD_EMAIL}}
Zip: {{LEAD_ZIP}}
{{LEAD_PHONE_LINE}}Estimate: {{ESTIMATE_MIN}} – {{ESTIMATE_MAX}}
Submitted: {{SUBMITTED_AT}}`;
