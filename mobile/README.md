# FlowRide for iPhone and Android

The apps are a native shell ([Capacitor](https://capacitorjs.com)) that loads the live FlowRide website. The website is the engine. Every feature, fix and privacy rule ships once, on the web, and both apps get it instantly without app-store updates.

What the app adds on top of the website:
- a home-screen icon and splash screen, launching full screen
- the **native share sheet** for event links (`@capacitor/share`)
- the **Android back button** going back through pages instead of closing the app (`@capacitor/app`)
- a friendly offline screen when there's no signal
- WhatsApp and phone links open straight in the WhatsApp and Phone apps

The web code detects the app through `window.Capacitor` (`src/native.ts`), so there's no separate mobile codebase.

## Point it at your site

```bash
cd mobile
npm install
FLOWRIDE_URL=https://flowride.your-domain.org npx cap sync
```

The URL is written into the native projects at sync time. Use HTTPS. To test against a dev server, use `FLOWRIDE_URL=http://10.0.2.2:3000` for the Android emulator, or your computer's LAN IP for a real phone.

## Build

**Android** (needs Android Studio or the Android SDK):
```bash
npm run android          # opens Android Studio
npm run build:android    # → android/app/build/outputs/apk/debug/app-debug.apk
```

**iPhone** (needs a Mac with Xcode 16+; uses Swift Package Manager, no CocoaPods):
```bash
npm run ios              # opens Xcode → pick your Team under Signing → Run
```

CI builds both on every push (`.github/workflows/ci.yml`). Download the APK or the simulator app from the run's *Artifacts*. Set the repository variable `FLOWRIDE_URL` (Settings → Secrets and variables → Actions → Variables) so CI builds point at your real site.

## Publishing

| | Android (Google Play) | iPhone (App Store) |
|---|---|---|
| Account | Play Console, $25 one-off | Apple Developer Program, $99/year |
| Release build | `./gradlew bundleRelease` + upload key | Xcode → Product → Archive |
| App ID | `org.flowride.app` (change in `capacitor.config.ts` before first release) | same |
| Privacy label | Data safety: name + phone, app functionality, not shared for ads, deletable in app | Contact Info: name, phone. Linked to user, not used for tracking |
| Privacy policy URL | `https://your-site/privacy` | same |

**Apple review note (guideline 4.2, "minimum functionality"):** Apple sometimes rejects apps that are "just a website". To reduce that risk, the app uses native share, a native splash and offline handling. The strongest next step is **push notifications** ("Your driver accepted!") via `@capacitor/push-notifications`, which the website can't do reliably on iPhone. That's the recommended v2 feature. Until then, people can use the website or *Add to Home Screen*, which needs no App Store at all.

## Icons

Source images are in `assets/`. Regenerate with:
```bash
npx @capacitor/assets generate --iconBackgroundColor '#059669' --splashBackgroundColor '#059669'
```
