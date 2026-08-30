import crypto from 'crypto';

/**
 * Amazon SNS HTTPS-endpoint message envelope.
 *
 * NOTE: this only exists when the subscription has "raw message delivery"
 * turned OFF. With raw delivery on, SNS posts the bare SES event with no
 * signature at all and there is no way to authenticate it — the subscription
 * created by the infrastructure stack must therefore leave raw delivery off.
 */
export interface SnsMessage {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
  MessageId: string;
  Token?: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  SubscribeURL?: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL?: string;
  SigningCertUrl?: string;
}

/**
 * Hosts SNS is allowed to serve its signing certificate (and its confirmation
 * endpoint) from. Anchored, so `sns.us-east-1.amazonaws.com.evil.test` and
 * `evil-sns.us-east-1.amazonaws.com` are both rejected.
 */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** Messages older than this are rejected, so a captured POST cannot be replayed. */
const MAX_MESSAGE_AGE_MS = 60 * 60_000;

/**
 * The fields that go into the signed string, in the exact order AWS specifies.
 * Absent optional fields (Subject) are skipped; the rest are mandatory.
 */
const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation:
    ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation:
    ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

const certCache = new Map<string, crypto.KeyObject>();

function assertSnsUrl(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Malformed ${what}`);
  }
  if (url.protocol !== 'https:' || !SNS_HOST.test(url.hostname)) {
    throw new Error(`${what} is not an Amazon SNS endpoint`);
  }
  return url;
}

async function getSigningKey(certUrl: string): Promise<crypto.KeyObject> {
  const url = assertSnsUrl(certUrl, 'SigningCertURL');
  if (!url.pathname.endsWith('.pem')) throw new Error('SigningCertURL is not a certificate');

  const cached = certCache.get(url.href);
  if (cached) return cached;

  const res = await fetch(url.href, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not fetch SNS signing certificate (${res.status})`);
  const pem = await res.text();

  const key = new crypto.X509Certificate(pem).publicKey;
  if (certCache.size > 32) certCache.clear();
  certCache.set(url.href, key);
  return key;
}

/** Builds the canonical `key\nvalue\n...` string AWS signed. */
function stringToSign(msg: SnsMessage): string {
  const fields = SIGNED_FIELDS[msg.Type];
  if (!fields) throw new Error(`Unsupported SNS message type "${msg.Type}"`);

  let out = '';
  for (const field of fields) {
    const value = (msg as unknown as Record<string, unknown>)[field];
    // Subject is the only optional signed field; everything else must be there.
    if (value === undefined || value === null) {
      if (field === 'Subject') continue;
      throw new Error(`SNS message is missing the signed field "${field}"`);
    }
    out += `${field}\n${String(value)}\n`;
  }
  return out;
}

/**
 * Verifies an SNS message against Amazon's published signing certificate.
 *
 * Checks, in order: the message type is one we sign-check, the signing
 * certificate is served over HTTPS from an `sns.<region>.amazonaws.com` host
 * (so a forged `SigningCertURL` cannot point us at an attacker's key), the
 * RSA signature over the canonical field string verifies against that
 * certificate's public key, and the message is recent enough not to be a replay.
 *
 * Throws with a reason on failure; returns normally when the message is genuine.
 */
export async function verifySnsMessage(msg: SnsMessage): Promise<void> {
  if (!msg.Signature) throw new Error('SNS message has no signature');

  const certUrl = msg.SigningCertURL ?? msg.SigningCertUrl;
  if (!certUrl) throw new Error('SNS message has no SigningCertURL');

  // SignatureVersion 1 is RSA over SHA1, version 2 is RSA over SHA256.
  const algorithm = msg.SignatureVersion === '2' ? 'RSA-SHA256'
    : msg.SignatureVersion === '1' ? 'RSA-SHA1'
    : null;
  if (!algorithm) throw new Error(`Unsupported SNS SignatureVersion "${msg.SignatureVersion}"`);

  const payload = stringToSign(msg);
  const key = await getSigningKey(certUrl);

  const verifier = crypto.createVerify(algorithm);
  verifier.update(payload, 'utf8');
  verifier.end();
  if (!verifier.verify(key, msg.Signature, 'base64')) {
    throw new Error('SNS signature verification failed');
  }

  const sent = Date.parse(msg.Timestamp);
  if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > MAX_MESSAGE_AGE_MS) {
    throw new Error('SNS message timestamp is outside the accepted window');
  }
}

/**
 * Topics this endpoint accepts. A valid signature only proves the message came
 * from SNS — anyone with an AWS account could point their own topic at this URL —
 * so the topic itself has to be allow-listed. `SES_SNS_TOPIC_ARN` (comma
 * separated) is authoritative; with it unset we fall back to the topic *name*
 * the infrastructure stack creates.
 */
const DEFAULT_TOPIC_NAME = 'arham-ses-events';

export function isAllowedTopic(topicArn: string): boolean {
  const configured = (process.env.SES_SNS_TOPIC_ARN ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (configured.length) return configured.includes(topicArn);

  const name = topicArn.split(':').pop();
  return name === (process.env.SES_SNS_TOPIC_NAME ?? DEFAULT_TOPIC_NAME);
}

/**
 * Completes a subscription by calling back the `SubscribeURL`. The URL is
 * re-validated against the SNS host allow-list first — it arrives in the request
 * body, so following it blindly would be an SSRF.
 */
export async function confirmSubscription(subscribeUrl: string): Promise<void> {
  const url = assertSnsUrl(subscribeUrl, 'SubscribeURL');
  const res = await fetch(url.href, { cache: 'no-store', redirect: 'error' });
  if (!res.ok) throw new Error(`SNS subscription confirmation failed (${res.status})`);
}
