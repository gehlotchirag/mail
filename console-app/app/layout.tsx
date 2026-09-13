import type { Metadata } from 'next';
import Script from 'next/script';
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
      <body>
        {children}

        {/* Meta Pixel Code */}
        <Script id="fb-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '1565498614904428');
          fbq('track', 'PageView');`}
        </Script>
        <noscript>
          <img height="1" width="1" style={{ display: 'none' }} src="https://www.facebook.com/tr?id=1565498614904428&ev=PageView&noscript=1" alt="" />
        </noscript>
        {/* End Meta Pixel Code */}
      </body>
    </html>
  );
}
