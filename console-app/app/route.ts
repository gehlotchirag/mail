import { NextResponse, type NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSession } from '@/lib/auth';

/**
 * The marketing landing page at `/` — a route handler, not a page.tsx
 * component, deliberately. Its stylesheet (public/landing.html) defines its
 * own `:root` custom properties (--bg, --accent, ...) and bare `body`/`a`/`*`
 * element selectors, every one of which already exists in this app's own
 * globals.css with different values. Rendered as a normal page inside
 * layout.tsx, those two stylesheets would collide in the same document —
 * reskinning the dashboard with the landing page's palette, or the reverse,
 * depending on cascade order, and there would be no reliable way to keep
 * that from drifting as either stylesheet changes.
 *
 * Returning a raw HTML Response bypasses layout.tsx and globals.css
 * entirely: this is a wholly separate document as far as the browser is
 * concerned, so there is no shared DOM or CSSOM to collide in either
 * direction. The landing page's own copy of the fonts it needs, its inline
 * <style>, and its inline <script> (nav scroll shadow, domain-field
 * normalizing) travel with it and need nothing from this app to run.
 *
 * public/landing.html is the single canonical copy — it has to live inside
 * this app's own tree because deploy.py only ships files under console-app/;
 * the repo's landing-pages/ directory was never wired to reach a server at
 * all, which was the actual reason this page wasn't live before this file
 * existed. Edit it in place rather than maintaining a second copy elsewhere.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (session) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  const html = await readFile(path.join(process.cwd(), 'public', 'landing.html'), 'utf-8');
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
