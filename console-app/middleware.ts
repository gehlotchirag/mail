import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'arham-console-jwt-secret-2026-change-in-prod'
);

const PUBLIC = ['/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/billing/webhook', '/api/health'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
