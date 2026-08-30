import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const base = process.env.NEXT_PUBLIC_URL!;

  const jar = await cookies();
  const savedState = jar.get('cf_oauth_state')?.value;
  if (!savedState || savedState !== state || !code) {
    return NextResponse.redirect(`${base}/dashboard/domains?error=cf_oauth`);
  }

  // state encodes domainId:nonce
  const domainId = savedState.split(':')[0];

  const tokenRes = await fetch('https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.CLOUDFLARE_CLIENT_ID!,
      client_secret: process.env.CLOUDFLARE_CLIENT_SECRET!,
      redirect_uri: `${base}/api/auth/cloudflare/callback`,
    }),
  });

  const tokenData = await tokenRes.json() as { access_token?: string; refresh_token?: string; error?: string };
  if (!tokenData.access_token) {
    return NextResponse.redirect(`${base}/dashboard/domains/${domainId}?error=cf_token`);
  }

  const payload = JSON.stringify({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? '',
  });

  const res = NextResponse.redirect(`${base}/dashboard/domains/${domainId}?cf_connected=1`);
  res.cookies.set('cf_pending', payload, {
    httpOnly: true, sameSite: 'lax', maxAge: 300,
    secure: process.env.NODE_ENV === 'production',
  });
  res.cookies.delete('cf_oauth_state');
  return res;
}
