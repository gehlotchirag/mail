import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSession } from '@/lib/auth';

// Cloudflare OAuth app — register at dash.cloudflare.com → My Profile → API Tokens → OAuth Apps
// Scopes needed: zone:read  dns_records:edit  offline_access
// Redirect URI: https://inbox.arhamworkspace.tech/api/auth/cloudflare/callback

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_URL));

  const clientId = process.env.CLOUDFLARE_CLIENT_ID;
  if (!clientId) {
    // No OAuth app configured — send user to manual token creation with the right template pre-selected
    const url = new URL(req.url);
    const domainId = url.searchParams.get('domainId') ?? '';
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_URL}/dashboard/domains/${domainId}?cf_manual=1`
    );
  }

  const state = `${req.url.split('domainId=')[1] ?? ''}:${crypto.randomBytes(12).toString('hex')}`;
  const redirectUri = `${process.env.NEXT_PUBLIC_URL}/api/auth/cloudflare/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'zone:read dns_records:edit offline_access',
    state,
  });

  const res = NextResponse.redirect(`https://dash.cloudflare.com/oauth2/auth?${params}`);
  res.cookies.set('cf_oauth_state', state, {
    httpOnly: true, sameSite: 'lax', maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
