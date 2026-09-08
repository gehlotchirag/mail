import nodemailer from 'nodemailer';

// One transporter for the process. Built lazily so that a missing/incomplete SMTP
// config surfaces as a logged send failure on the one request that needed mail,
// rather than as a crash at module load that takes the whole console down.
let cached: nodemailer.Transporter | null = null;

function transporter(): nodemailer.Transporter {
  if (!cached) {
    cached = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: parseInt(process.env.SMTP_PORT ?? '587'),
      secure: process.env.SMTP_SECURE === 'true',
      // SES rejects plaintext AUTH on 587; STARTTLS is mandatory there and harmless
      // anywhere else that already speaks it.
      requireTLS: process.env.SMTP_SECURE !== 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
        : undefined,
    });
  }
  return cached;
}

export function mailerConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
}

/** Absolute base URL for links inside emails. Relative links are useless in mail. */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_URL ?? 'https://inbox.arhamworkspace.tech').replace(/\/+$/, '');
}

/**
 * Shared shell so verification and reset mail look like the same product.
 * Inline styles only — mail clients strip <style> blocks.
 */
function layout(opts: { heading: string; intro: string; cta: string; ctaUrl: string; footer: string }): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f0f6ff;margin:0;padding:2rem">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #dbeafe;border-radius:16px;padding:2rem">
    <div style="text-align:center;margin-bottom:1.5rem">
      <div style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:12px;background:#2563eb;color:#fff;font-size:22px;margin-bottom:1rem">&#9889;</div>
      <h1 style="color:#0f2040;font-size:1.3rem;margin:0">${opts.heading}</h1>
    </div>
    <p style="color:#3b5f8a;font-size:0.9rem;line-height:1.6">${opts.intro}</p>
    <div style="text-align:center;margin:1.75rem 0">
      <a href="${opts.ctaUrl}" style="display:inline-block;padding:.8rem 1.75rem;background:#2563eb;color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:0.95rem">${opts.cta}</a>
    </div>
    <p style="color:#7fa8d0;font-size:0.8rem;line-height:1.5">${opts.footer}</p>
    <p style="color:#a9c4dd;font-size:0.72rem;line-height:1.5;margin-top:1.25rem;word-break:break-all">
      If the button does not work, paste this link into your browser:<br>${opts.ctaUrl}
    </p>
  </div>
</body>
</html>`;
}

async function send(to: string, subject: string, text: string, html: string): Promise<void> {
  // SES only accepts a From address on a verified identity, so this must stay a
  // domain we own — not a tenant's address.
  const from = process.env.SMTP_FROM ?? 'Arham Workspace <noreply@arhamworkspace.tech>';
  await transporter().sendMail({ from, to, subject, text, html });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await send(
    to,
    'Reset your Arham Console password',
    `You requested a password reset for your Arham Console account.\n\n`
      + `Set a new password using the link below (valid for 1 hour):\n\n${resetUrl}\n\n`
      + `If you did not request this, ignore this email — your password will not change.`,
    layout({
      heading: 'Reset your password',
      intro: 'You requested a password reset for your Arham Console account. Choose a new password using the button below.',
      cta: 'Reset password',
      ctaUrl: resetUrl,
      footer: 'This link expires in 1 hour and can be used once. If you did not request a password reset, ignore this email — your password will not change.',
    }),
  );
}

export async function sendVerificationEmail(to: string, name: string, verifyUrl: string): Promise<void> {
  await send(
    to,
    'Confirm your email address',
    `Welcome to Arham Workspace, ${name}.\n\n`
      + `Confirm this email address to finish setting up your account (valid for 24 hours):\n\n${verifyUrl}\n\n`
      + `If you did not create this account, ignore this email.`,
    layout({
      heading: 'Confirm your email address',
      intro: `Welcome to Arham Workspace, ${name}. Confirm this address so we can reach you about your domains, mailboxes and billing.`,
      cta: 'Confirm email address',
      ctaUrl: verifyUrl,
      footer: 'This link expires in 24 hours. You can sign in before confirming, but adding a domain stays locked until this address is verified. If you did not create this account, ignore this email.',
    }),
  );
}
