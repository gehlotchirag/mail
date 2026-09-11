import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable must be set');
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

// Routes reachable without a console session. Anything listed here authenticates
// the CALLER itself rather than relying on a session cookie:
//   /api/billing/webhook      — verifies the Razorpay signature
//   /api/auth/verify-email    — the link in a confirmation email is opened by a
//                               browser that may have no session (mail is often read
//                               on another device); the single-use token in the URL
//                               is the credential.
//   /api/ses/notifications    — verifies the Amazon SNS message signature against
//                               Amazon's signing certificate and an allow-listed
//                               topic ARN. SNS cannot present a session cookie, so
//                               while this sat behind the session check every bounce
//                               and complaint notification was rejected with 401 and
//                               silently dropped — which is how a sending domain
//                               accrues an unnoticed bounce rate and gets throttled.
const PUBLIC = ['/login', '/signup', '/forgot-password', '/reset-password', '/api/auth/login', '/api/auth/signup', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email', '/api/billing/webhook', '/api/ses/notifications', '/api/health'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Exact match only — the marketing landing page, served by app/route.ts.
  // PUBLIC's startsWith checks would treat '/' as a prefix of every path if
  // it were added there instead, making the whole app public; this stays a
  // narrow, explicit exception.
  if (pathname === '/') return NextResponse.next();
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) return NextResponse.next();

  const token = req.cookies.get('console_token')?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }
  try {
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
