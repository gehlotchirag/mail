import { query, queryOne } from './db';

/** SES feedback payload — `notificationType` on the legacy feedback topics,
 *  `eventType` when the notification comes from a configuration set. */
export interface SesEvent {
  notificationType?: string;
  eventType?: string;
  mail?: {
    messageId?: string;
    source?: string;
    destination?: string[];
  };
  bounce?: {
    feedbackId?: string;
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: Array<{
      emailAddress?: string;
      action?: string;
      status?: string;
      diagnosticCode?: string;
    }>;
  };
  complaint?: {
    feedbackId?: string;
    complaintFeedbackType?: string;
    complaintSubType?: string;
    complainedRecipients?: Array<{ emailAddress?: string }>;
  };
}

export interface SuppressionOutcome {
  eventType: string;
  /** Addresses written to the suppression list and now blocked. */
  suppressed: string[];
  /** Addresses recorded but still sendable (soft/transient bounces). */
  recorded: string[];
}

/** SES sometimes reports `Display Name <addr@example.com>`. */
function normaliseAddress(raw: string | undefined): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const address = (angled ? angled[1] : raw).trim().toLowerCase();
  return address.includes('@') ? address : null;
}

async function upsert(entry: {
  email: string;
  reason: string;
  subType: string | null;
  suppressed: boolean;
  diagnostic: string | null;
  feedbackId: string | null;
  source: string | null;
  sesMessageId: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO email_suppressions
       (email, reason, sub_type, suppressed, diagnostic, feedback_id, source, ses_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) DO UPDATE SET
       reason = EXCLUDED.reason,
       sub_type = EXCLUDED.sub_type,
       -- Never un-suppress: a permanent failure followed by a transient one
       -- must not put the address back into rotation.
       suppressed = email_suppressions.suppressed OR EXCLUDED.suppressed,
       diagnostic = COALESCE(EXCLUDED.diagnostic, email_suppressions.diagnostic),
       feedback_id = EXCLUDED.feedback_id,
       source = COALESCE(EXCLUDED.source, email_suppressions.source),
       ses_message_id = EXCLUDED.ses_message_id,
       occurrences = email_suppressions.occurrences + 1,
       last_seen_at = NOW()`,
    [
      entry.email, entry.reason, entry.subType, entry.suppressed,
      entry.diagnostic, entry.feedbackId, entry.source, entry.sesMessageId,
    ]
  );
}

/**
 * Records one SES feedback event.
 *
 * Hard (`Permanent`) bounces and every complaint are suppressed — the platform
 * must stop sending to them or SES will pull production access. Transient and
 * Undetermined bounces are recorded for visibility but stay sendable.
 */
export async function recordSesEvent(event: SesEvent): Promise<SuppressionOutcome> {
  const eventType = event.eventType ?? event.notificationType ?? 'Unknown';
  const outcome: SuppressionOutcome = { eventType, suppressed: [], recorded: [] };
  const source = event.mail?.source ?? null;
  const sesMessageId = event.mail?.messageId ?? null;

  if (eventType === 'Bounce' && event.bounce) {
    const permanent = event.bounce.bounceType === 'Permanent';
    for (const recipient of event.bounce.bouncedRecipients ?? []) {
      const email = normaliseAddress(recipient.emailAddress);
      if (!email) continue;
      await upsert({
        email,
        reason: permanent ? 'bounce' : 'transient_bounce',
        subType: [event.bounce.bounceType, event.bounce.bounceSubType].filter(Boolean).join('/') || null,
        suppressed: permanent,
        diagnostic: recipient.diagnosticCode ?? recipient.status ?? null,
        feedbackId: event.bounce.feedbackId ?? null,
        source,
        sesMessageId,
      });
      (permanent ? outcome.suppressed : outcome.recorded).push(email);
    }
    return outcome;
  }

  if (eventType === 'Complaint' && event.complaint) {
    for (const recipient of event.complaint.complainedRecipients ?? []) {
      const email = normaliseAddress(recipient.emailAddress);
      if (!email) continue;
      await upsert({
        email,
        reason: 'complaint',
        subType: event.complaint.complaintFeedbackType ?? event.complaint.complaintSubType ?? null,
        suppressed: true,
        diagnostic: null,
        feedbackId: event.complaint.feedbackId ?? null,
        source,
        sesMessageId,
      });
      outcome.suppressed.push(email);
    }
    return outcome;
  }

  // Delivery / Send / Open / Click / Reject and friends need no suppression.
  return outcome;
}

/** True when the platform must not send to this address. */
export async function isSuppressed(email: string): Promise<boolean> {
  const address = normaliseAddress(email);
  if (!address) return false;
  const row = await queryOne<{ suppressed: boolean }>(
    'SELECT suppressed FROM email_suppressions WHERE email = $1', [address]
  );
  return !!row?.suppressed;
}

/**
 * Marks an SNS message id as processed. Returns false when it has been seen
 * before, so a redelivery does not double-count occurrences.
 */
export async function claimNotification(
  snsMessageId: string, topicArn: string, eventType: string | null
): Promise<boolean> {
  const rows = await query<{ sns_message_id: string }>(
    `INSERT INTO ses_notifications (sns_message_id, topic_arn, event_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (sns_message_id) DO NOTHING
     RETURNING sns_message_id`,
    [snsMessageId, topicArn, eventType]
  );
  return rows.length > 0;
}
