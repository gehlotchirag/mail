import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    await query('SELECT 1');
    return NextResponse.json({ status: 'ok', db: 'connected', ts: Date.now() });
  } catch (e) {
    return NextResponse.json(
      { status: 'error', db: 'disconnected', error: String(e) },
      { status: 503 }
    );
  }
}
