import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const accountsServer = url.searchParams.get('accounts-server') ?? 'https://accounts.zoho.in';
  const base = process.env.NEXT_PUBLIC_URL!;

  const cookieJar = await cookies();
  const savedState = cookieJar.get('zoho_oauth_state')?.value;
  if (!savedState || savedState !== state || !code) {
    return NextResponse.redirect(`${base}/dashboard/migration?error=oauth_state`);
  }

  // Exchange authorisation code for tokens
  const tokenRes = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      redirect_uri: `${base}/api/auth/zoho/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json() as {
    access_token?: string; refresh_token?: string; error?: string;
  };
  if (!tokenData.access_token) {
    console.error('[zoho-oauth] token exchange failed:', tokenData);
    return NextResponse.redirect(`${base}/dashboard/migration?error=oauth_failed`);
  }

  // Determine API base from accounts server (in/com/eu/au/jp)
  const region = accountsServer.includes('.in') ? 'in' : 'com';
  const mailApiBase = region === 'in' ? 'https://mail.zoho.in/api' : 'https://mail.zoho.com/api';

  // Fetch the first Zoho account (org) to get orgId
  let orgId = '';
  let displayEmail = '';
  try {
    const acctRes = await fetch(`${mailApiBase}/accounts?limit=1`, {
      headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
    });
    const acctData = await acctRes.json() as { data?: { accountId?: string; emailAddress?: string }[] };
    orgId = acctData.data?.[0]?.accountId ?? '';
    displayEmail = acctData.data?.[0]?.emailAddress ?? '';
  } catch { /* non-fatal — user can fill org ID manually */ }

  const payload = JSON.stringify({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? '',
    orgId,
    displayEmail,
    region,
    accountsServer,
  });

  const res = NextResponse.redirect(`${base}/dashboard/migration?zoho_connected=1`);
  res.cookies.set('zoho_pending', payload, {
    httpOnly: true, sameSite: 'lax', maxAge: 300,
    secure: process.env.NODE_ENV === 'production',
  });
  res.cookies.delete('zoho_oauth_state');
  return res;
}
