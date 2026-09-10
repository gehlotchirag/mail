# arhamemail-mobile

Capacitor mobile app for Inbox Mail.

## Stack

- Capacitor
- Firebase Cloud Messaging (FCM) for push notifications
- Integrates with `arhamemail-webmail` push relay API

## Setup

### Build toolchain

Xcode is the only piece that needs an installer with a login — everything else
lives under `$HOME` and needs no sudo:

```sh
# Node 22 LTS, unpacked rather than installed (no Homebrew on the build Mac)
curl -sL https://nodejs.org/dist/v22.23.2/node-v22.23.2-darwin-x64.tar.gz \
  | tar -xz -C ~/.local && mv ~/.local/node-v22.23.2-darwin-x64 ~/.local/node
export PATH="$HOME/.local/node/bin:$PATH"
```

CocoaPods is the awkward one. macOS ships Ruby 2.6, and current versions of
CocoaPods' dependency tree require Ruby 3.1+, so a plain `gem install cocoapods`
fails partway through on whichever transitive gem it reaches first. Pin the
chain, oldest first, and pin CocoaPods to the version that generated
`ios/App/Podfile.lock` (1.15.2):

```sh
export GEM_HOME="$HOME/.gem/ruby/2.6.0"
export PATH="$GEM_HOME/bin:$PATH"
for g in ffi:1.15.5 zeitwerk:2.6.18 i18n:1.14.8 drb:2.0.6 \
         securerandom:0.3.2 activesupport:6.1.7.10 concurrent-ruby:1.3.4; do
  gem install --user-install "${g%%:*}" -v "${g##*:}" --no-document
done
gem install --user-install cocoapods -v 1.15.2 --no-document
```

`concurrent-ruby` has to stay at 1.3.4: 1.3.5 dropped an implicit
`require 'logger'` that activesupport 6.1 depends on, and without it every `pod`
command dies on `uninitialized constant LoggerThreadSafeLevel::Logger`. If a
newer one gets pulled in, `gem uninstall concurrent-ruby -v 1.3.8` and reinstall
1.3.4.

Replacing all of the above with `brew install node cocoapods` is the better move
on any machine that already has Homebrew.

### Building

```sh
npm install
npm run build          # tsc — compiles src/ to www/
npx cap sync ios       # copies web assets, then runs pod install
npx cap open ios       # opens ios/App/App.xcworkspace
```

`cap sync` shells out to `xcodebuild` for the `pod install` step, so it fails
with a `xcode-select` error until full Xcode is installed and selected:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

`npx cap copy ios` does the asset/config half without touching Xcode, which is
enough when no plugin has changed.

Note the app runs in remote-URL mode (`server.url` in `capacitor.config.ts`), so
the WebView loads the live webui. Changes to `webui/` reach the device after a
**server** deploy — rebuilding the app does not pick them up.

## Push Notifications

Registration happens in `webui/components/capacitor-push-registration.tsx`, not
in this package. The app runs in remote-URL mode (`server.url` in
`capacitor.config.ts`), so the WebView loads the live webui directly and
`src/index.ts` here never executes — see the comment at the top of that file.
The webui component POSTs to:

```
POST /api/push/mobile/register
```

which lands on `webui/app/api/push/mobile/register/route.ts`. That route,
`webui/app/api/push/mobile/jmap/[deviceClientId]/route.ts` (the JMAP
PushSubscription relay callback), and `webui/lib/push/fcm-sender.ts` (sends via
Firebase Admin) are the full server-side path — see them for the relay
implementation, and their file-level comments for what each does.

### Known gaps, as of this setup pass

- **Android**: needs a real `google-services.json` in `android/app/` (gitignored,
  supplied per-environment) — `android/app/build.gradle` skips the Firebase
  plugin and logs a warning without it, rather than failing the build.
- **iOS**: `AppDelegate.swift` now forwards APNs registration into Capacitor's
  bridge (required per `@capacitor/push-notifications`'s README — without it
  `PushNotifications.register()` never resolves on iOS at all), and
  `Info.plist` declares the `remote-notification` background mode the
  data-only pushes need. Two things still need doing in Xcode once it's
  installed, and can't be done from a text edit:
  - **Enable the Push Notifications capability** (Signing & Capabilities tab) —
    this is what actually generates the entitlement and requests a real APNs
    token; without it the permission prompt itself fails.
  - **Bridge the APNs token to an FCM token.** `@capacitor/push-notifications`
    hands back the raw APNs device token on iOS (there's no Firebase
    involvement in the plugin itself, confirmed from its own README), but the
    server sends every push through Firebase Admin's `messaging.send()`, which
    requires an FCM token — the two don't currently meet. Fixing this means
    adding the Firebase iOS SDK (a `FirebaseMessaging` pod +
    `GoogleService-Info.plist` + a bit more `AppDelegate.swift` wiring to
    exchange the APNs token for an FCM one) or moving iOS sends server-side
    onto direct APNs, bypassing Firebase for that platform. Deliberately left
    undone here rather than hand-written and unverified — this needs the
    actual `GoogleService-Info.plist` and a compile check in Xcode, neither of
    which was available while this pass was done.
- **Web relay**: separately, browser Web Push (`webui/lib/web-push.ts`) falls
  back to the upstream project's hosted relay
  (`notifications.relay.bulwarkmail.org`) whenever `NEXT_PUBLIC_PUSH_RELAY_URL`
  is unset — worth knowing this is a third-party dependency in the
  notification path until that's set to something self-hosted.
