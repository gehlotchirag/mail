import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tech.arhamworkspace.inbox',
  appName: 'Arham Inbox',
  // webDir is required by Capacitor CLI but unused in remote-URL (server.url) mode.
  webDir: 'www',
  server: {
    // The WebView loads the live server — no static export needed.
    // All webui features (mic, file upload, AI draft, etc.) work automatically.
    // Any change to the webui is live immediately after a server rebuild.
    url: 'https://app.arhamworkspace.tech',
    cleartext: false,
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
  },
};

export default config;
