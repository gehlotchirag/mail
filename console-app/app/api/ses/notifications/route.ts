import { NextResponse } from 'next/server';
import { ensureDb } from '@/lib/db';
import { verifySnsMessage, isAllowedTopic, confirmSubscription, type SnsMessage } from '@/lib/sns';
import { recordSesEvent, claimNotification, type SesEvent } from '@/lib/suppression';

export const dynamic = 'force-dynamic';

/**
 * Amazon SNS delivery endpoint for the SES bounce/complaint configuration set.
 *
 * This route is PUBLIC — it is the URL the `arham-ses-events` topic posts to —
 * so nothing here may be trusted before `verifySnsMessage` has checked the
 * message against Amazon's signing certificate, and the topic ARN has been
 * matched against the allow-list. Requests that fail either check get a 403 and
 * are never written to the database.
 */
export async function POST(req: Request) {
  // SNS posts with Content-Type text/plain, so read the raw body and parse it.
  const raw = await req.text();

  let msg: SnsMessage;
  try {
    msg = JSON.parse(raw) as SnsMessage;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // The header is a hint only; the body's own Type field is what we act on.
  if (!msg.Type || !msg.TopicArn || !msg.MessageId) {
    return NextResponse.json(
      { error: 'Not an SNS message envelope. Raw message delivery must be disabled.' },
      { status: 400 }
    );
  }

  if (!isAllowedTopic(msg.TopicArn)) {
    console.warn(`[ses] Rejected SNS message from unexpected topic ${msg.TopicArn}`);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await verifySnsMessage(msg);
  } catch (e) {
    console.warn(`[ses] Rejected SNS message ${msg.MessageId}: ${(e as Error).message}`);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!msg.SubscribeURL) {
      return NextResponse.json({ error: 'Missing SubscribeURL' }, { status: 400 });
    }
    try {
      await confirmSubscription(msg.SubscribeURL);
    } catch (e) {
      console.error(`[ses] Subscription confirmation failed: ${(e as Error).message}`);
      return NextResponse.json({ error: 'Confirmation failed' }, { status: 502 });
    }
    console.log(`[ses] Confirmed SNS subscription for topic ${msg.TopicArn}`);
    return NextResponse.json({ confirmed: true });
  }

  if (msg.Type === 'UnsubscribeConfirmation') {
    console.warn(`[ses] SNS unsubscribed this endpoint from ${msg.TopicArn}`);
    return NextResponse.json({ received: true });
  }

  if (msg.Type !== 'Notification') {
    return NextResponse.json({ error: 'Unsupported message type' }, { status: 400 });
  }

  let event: SesEvent;
  try {
    event = JSON.parse(msg.Message) as SesEvent;
  } catch {
    console.error(`[ses] Notification ${msg.MessageId} carried a non-JSON Message`);
    // 200: retrying will not make the payload parseable.
    return NextResponse.json({ received: true, ignored: 'unparseable' });
  }

  try {
    await ensureDb();
    const eventType = event.eventType ?? event.notificationType ?? null;

    // SNS delivers at least once — a redelivery must not inflate the counters.
    if (!await claimNotification(msg.MessageId, msg.TopicArn, eventType)) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const outcome = await recordSesEvent(event);
    if (outcome.suppressed.length) {
      console.warn(
        `[ses] ${outcome.eventType}: suppressed ${outcome.suppressed.join(', ')}`
      );
    }
    return NextResponse.json({
      received: true,
      eventType: outcome.eventType,
      suppressed: outcome.suppressed.length,
      recorded: outcome.recorded.length,
    });
  } catch (e) {
    console.error('[ses] Failed to record notification:', e);
    // 500 so SNS retries — the message was genuine, we just could not store it.
    return NextResponse.json({ error: 'Failed to record notification' }, { status: 500 });
  }
}
