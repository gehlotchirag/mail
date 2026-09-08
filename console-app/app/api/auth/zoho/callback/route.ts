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

  // Fetch orgId and displayEmail from Zoho accounts endpoint
  let orgId = '';
  let displayEmail = '';
  let firstAccountId = '';
  try {
    const acctRes = await fetch(`${mailApiBase}/accounts`, {
      headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
    });
    const acctRaw = await acctRes.text();
    console.log('[zoho-oauth] accounts raw:', acctRaw);
    const acctData = JSON.parse(acctRaw) as {
      data?: {
        accountId?: string;
        emailAddress?: Array<{ mailId?: string; isPrimary?: boolean }> | string;
        primaryEmailAddress?: string;
        mailboxAddress?: string;
        policyId?: Record<string, unknown>;
      }[]
    };
    const acct = acctData.data?.[0];
    firstAccountId = acct?.accountId ?? '';
    // Zoho org admin API uses the ZOID (organization ID), not the personal accountId
    const zoid = acct?.policyId?.zoid;
    orgId = zoid ? String(zoid) : firstAccountId;
    // emailAddress can be an array of {mailId, isPrimary} objects or a plain string
    const emailField = acct?.emailAddress;
    if (Array.isArray(emailField)) {
      displayEmail = emailField.find(e => e.isPrimary)?.mailId
        ?? emailField[0]?.mailId
        ?? acct?.primaryEmailAddress
        ?? acct?.mailboxAddress
        ?? '';
    } else {
      displayEmail = emailField ?? acct?.primaryEmailAddress ?? acct?.mailboxAddress ?? '';
    }
  } catch (e) {
    console.error('[zoho-oauth] fetch error:', e);
  }
  console.log('[zoho-oauth] resolved orgId:', orgId, 'displayEmail:', displayEmail);

  // Probe: check if the org-level folder API works (paid Workplace) or returns 404
  // URL_RULE_NOT_CONFIGURED (free/personal). This determines whether an IMAP app
  // password is needed for content fetching.
  let isPersonal = true;
  if (orgId && firstAccountId) {
    try {
      const probeRes = await fetch(`${mailApiBase}/organization/${orgId}/accounts/${firstAccountId}/folders`, {
        headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
      });
      const probeText = await probeRes.text();
      // Paid orgs return 200; free/personal return 404 URL_RULE_NOT_CONFIGURED
      isPersonal = probeRes.status === 404 && probeText.includes('URL_RULE_NOT_CONFIGURED');
      console.log('[zoho-oauth] org probe →', probeRes.status, isPersonal ? 'personal/free' : 'paid org');
    } catch (e) {
      console.warn('[zoho-oauth] org probe failed, assuming personal:', e instanceof Error ? e.message : e);
    }
  }

  const payload = JSON.stringify({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? '',
    orgId,
    displayEmail,
    region,
    accountsServer,
    isPersonal,
  });

  const res = NextResponse.redirect(`${base}/dashboard/migration?zoho_connected=1`);
  res.cookies.set('zoho_pending', payload, {
    httpOnly: true, sameSite: 'lax', maxAge: 300,
    secure: process.env.NODE_ENV === 'production',
  });
  res.cookies.delete('zoho_oauth_state');
  return res;
}
