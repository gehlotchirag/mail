import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Arham Console', template: '%s — Arham Console' },
  description: 'Manage your Arham Workspace email, users and DNS',
  icons: {
    // favicon.ico in app/ is already auto-served by Next.js at /favicon.ico;
    // listed explicitly too since some browsers only check <link> tags.
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon/web/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon/web/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/icon/web/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: 'light' }}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
