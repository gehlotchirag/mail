import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_URL));

  const clientId = process.env.ZOHO_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL('/dashboard/migration?error=zoho_not_configured', process.env.NEXT_PUBLIC_URL)
    );
  }

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${process.env.NEXT_PUBLIC_URL}/api/auth/zoho/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    // organization.accounts.UPDATE is what lets us turn IMAP on for each mailbox.
    // Zoho disables IMAP for every user by default and exposes no bulk toggle in the
    // admin console — it is a per-user switch — so without this scope a 40-person
    // migration means 40 manual clicks before anything can be read.
    scope: 'ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.folders.READ,'
      + 'ZohoMail.organization.accounts.READ,ZohoMail.organization.accounts.UPDATE',
    redirect_uri: redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  // India-hosted accounts use accounts.zoho.in; adjust if your customer is global
  const authUrl = `https://accounts.zoho.in/oauth/v2/auth?${params}`;

  const res = NextResponse.redirect(authUrl);
  res.cookies.set('zoho_oauth_state', state, {
    httpOnly: true, sameSite: 'lax', maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
