import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'arham-console-jwt-secret-2026-change-in-prod'
);

export interface SessionPayload {
  orgId: string;
  email: string;
  name: string;
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get('console_token')?.value;
  if (!token) return null;
  return verifySession(token);
}

export function setSessionCookie(res: Response, token: string): void {
  res.headers.append(
    'Set-Cookie',
    `console_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}; ${process.env.NODE_ENV === 'production' ? 'Secure;' : ''}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.headers.append(
    'Set-Cookie',
    'console_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
}
