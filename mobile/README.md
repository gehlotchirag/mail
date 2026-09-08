# arhamemail-mobile

Capacitor mobile app for Inbox Mail.

## Stack

- Capacitor
- Firebase Cloud Messaging (FCM) for push notifications
- Integrates with `arhamemail-webmail` push relay API

## Setup

Coming soon — mobile app code to be added here.

## Push Notifications

The mobile app registers FCM tokens via:
```
POST https://app.arhamworkspace.tech/api/push/mobile/register
```

See `arhamemail-webmail` for the relay implementation.
