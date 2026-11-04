# Phone app sign-in: Google, Apple, tokens

Written 2026-11-04. How the JoyoArto phone app (`apps/mobile`, package and bundle id `com.joyodigitama.joyoarto`) signs
in, and the one-time Google Cloud and Apple steps it needs. Same approach as JoyoRogo's phone app
(`joyorogo/apps/native/src/lib/google-native.ts`, `app/login.tsx`).

## How it works

1. **Google** (Android and iPhone): `@react-native-google-signin/google-signin` shows Google's own account sheet (Play
   services on Android, the GoogleSignIn SDK on iOS) and returns an **ID token**. No browser, no redirect.
2. **Sign in with Apple** (iPhone only, App Store guideline 4.8 because Google sign-in is offered):
   `expo-apple-authentication` with a SHA-256 nonce returns Apple's identity token. JoyoRogo does the same.
3. The app posts the token to better-auth: `POST /api/auth/sign-in/social` with
   `{ provider: "google" | "apple", idToken: { token, nonce? } }`. The server verifies it (Google: issuer, signature and
   audience; Apple: Apple's JWKS, audience = bundle id), finds or creates the user (invite-only: `ALLOWED_EMAILS` or a
   pending household invite, as on the web) and starts a session.
4. better-auth's **bearer plugin** (`packages/auth/src/index.ts`) puts the signed session token in the `set-auth-token`
   response header. The app stores it in `expo-secure-store` (Android Keystore, iOS Keychain;
   `apps/mobile/src/lib/session-store.ts`) and sends `Authorization: Bearer <session token>` on every REST (`/api`) and
   oRPC (`/rpc`) call.
5. `apps/server/src/principal.ts` sends `brk_…` bearers to the personal-access-token table and every other bearer to
   the session, so the same header carries either. Sign-out calls `POST /api/auth/sign-out` with the bearer (revokes the
   session) and deletes it from the phone.

Secondary sign-ins stay: a pasted `brk_` token (web Settings → API tokens) and **Coba demo / Reviewer**
(`POST /api/demo/token`, a 7-day `brk_` token for the demo household).

Sessions last better-auth's default 7 days and are extended while the app is used (each request refreshes the expiry
once a day). An expired or revoked one gets `UNAUTHORIZED`; the app signs out and says so.

## Client ids

All Google OAuth clients live in the Google Cloud project **`joyorogo`** (JoyoArto reuses JoyoRogo's "JoyoRogo Web"
client because the project ran out of OAuth client quota, see the deployment notes). Native Google Sign-In only works
when the Android/iOS clients are in the **same project** as the web client the app names.

| Client | Type | Where it is used | Status |
| --- | --- | --- | --- |
| `915036968874-0ne1edkq0laljg6cdlnksor1hqpj9gfr.apps.googleusercontent.com` ("JoyoRogo Web") | Web application | Server `GOOGLE_CLIENT_ID` (secret); app `extra.googleWebClientId` in `apps/mobile/app.json`. Android ID tokens are issued for this audience. | exists |
| JoyoArto Android (release / upload key) | Android | Identifies the app to Google: package + SHA-1 | **to create** |
| JoyoArto Android (Play app signing) | Android | Same, for installs from Google Play | **to create** |
| JoyoArto Android (CI debug key), optional | Android | Sideloaded APKs built without the release keystore | optional |
| JoyoArto iOS | iOS | iPhone Google Sign-In; its id is the ID token's audience | **to create** |

Client ids are public (they ship inside the app); only the web client's secret is secret.

### Android: create two (or three) OAuth clients

Google Cloud console → project `joyorogo` → APIs & Services → Credentials → Create credentials → OAuth client ID →
**Android**:

- Package name: `com.joyodigitama.joyoarto` (all of them)
- SHA-1 certificate fingerprint, one client each:
  1. **Release/upload key** (signs the APKs from `android.yml` once the secrets exist, and the AAB uploaded to Play):
     on the Linux box, `keytool -list -v -keystore <the JoyoArto keystore from ~/.config/joyoarto/> -alias <ANDROID_KEY_ALIAS>`
     and copy the `SHA1:` line. CI prints it too: `android.yml` / `release-android.yml` logs now show
     `signing key SHA1: …` (APK) and `upload key SHA1: …` (AAB).
  2. **Play app signing key** (what users installing from Play actually run): Play Console → JoyoArto → Test and release →
     App integrity → App signing → "App signing key certificate" → SHA-1.
  3. Optional, **CI debug key** (APKs built without the keystore secrets, `signing key SHA1` in the build log). It is the
     React Native template's public debug keystore (SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`;
     check the build log). Only add it if you want Google sign-in on throwaway sideload builds.

Nothing changes in the app or server for Android: the ID token's audience is the web client, which the server already
accepts. Until a client with the right SHA-1 exists, Google answers `DEVELOPER_ERROR` and the app says Google sign-in
isn't available in this build (token and demo still work).

### iOS: create one OAuth client and wire it

1. Google Cloud console → project `joyorogo` → Credentials → Create OAuth client ID → **iOS**: bundle ID
   `com.joyodigitama.joyoarto`, App Store ID (once the app exists in App Store Connect), Team ID `F6Q6UFUK69`.
2. Copy its client id (`<number>-<hash>.apps.googleusercontent.com`) into **both**:
   - the app: `apps/mobile/app.json` → `expo.extra.googleIosClientId` (commit it; it is public), or the GitHub
     repository variable `JOYOARTO_GOOGLE_IOS_CLIENT_ID` (`release-ios.yml` passes it). `app.config.ts` then adds the
     reversed client id (`com.googleusercontent.apps.<number>-<hash>`) as a URL scheme through the google-signin config
     plugin; without an iOS client id the iPhone app hides the Google button.
   - the server: `apps/server/wrangler.jsonc` → `vars.GOOGLE_NATIVE_CLIENT_IDS` (uncomment the line; comma-separated),
     then deploy. iOS ID tokens carry the iOS client id as audience; without it the server answers `INVALID_TOKEN`.

### Sign in with Apple

Decision: **implemented**, as JoyoRogo did (guideline 4.8 asks for an equivalent privacy-friendly login whenever a
third-party one such as Google is offered).

- App: `app.json` `ios.usesAppleSignIn: true` and the `expo-apple-authentication` plugin add the
  `com.apple.developer.applesignin` entitlement; `build-ios.sh` fails the IPA without it.
- Signing: `release-ios.yml` asks `asc-ci-profile.py` for the **`APPLE_ID_AUTH`** capability on
  `com.joyodigitama.joyoarto` (enabled through the App Store Connect API with the primary-app-consent setting, as
  JoyoRogo's `enable-capabilities.py`) and makes a new App Store profile with it. Nothing to click by hand, but you can
  check it: developer.apple.com → Identifiers → `com.joyodigitama.joyoarto` → **Sign In with Apple** ticked ("Enable as
  a primary App ID"). No Services ID, key or client secret: the app sends the identity token, which the server verifies
  against Apple's keys.
- Server: `APPLE_BUNDLE_IDS = "com.joyodigitama.joyoarto"` in `wrangler.jsonc` (the token's audience).
- Invite-only still applies: an Apple ID that shares its real email is matched to (or allowed as) that email; one that
  chose **Hide My Email** gets a `@privaterelay.appleid.com` address that is not on `ALLOWED_EMAILS` and has no invite,
  so its sign-up is refused ("This account can't join JoyoArto yet"). Invite that relay address, or sign in with Google.
  The store reviewers use the demo code, not Apple.

## Only a device build can verify

- Android Google sign-in end to end (needs the Android clients above, a Play-services phone, the CI APK).
- iPhone Google sign-in (iOS client, URL scheme) and Sign in with Apple (entitlement, profile, Apple's sheet).
- That `set-auth-token` reaches the app through `fetch` on both platforms (the server test proves the header is sent).
- Sign-out revocation and the 401 → signed-out path against production.

## Created (4 Nov 2026)

| Client | Type | Fingerprint / bundle |
| --- | --- | --- |
| `915036968874-chs9i9f8mikaa3hvgbk4fsegd6pjfav5` "JoyoArto Android (Play signing)" | Android | SHA-1 `B3:54:79:8B:32:64:96:92:C7:32:27:6C:E1:2C:2C:F9:FC:EA:A2:E3` (Play app signing key) |
| `915036968874-lggi9ttf81jgue6d3iamdtlvoh2bvc4a` "JoyoArto Android (upload key)" | Android | SHA-1 `CE:32:1F:CA:D5:65:AD:2F:03:1D:30:75:90:36:DD:1C:CE:99:6B:BB` (release/upload keystore) |
| `915036968874-v9nu6n98eb34vqmnva034tu6donspavn` "JoyoArto iOS" | iOS | `com.joyodigitama.joyoarto`, team `F6Q6UFUK69` |

Android clients need no config (Google matches package + SHA-1); the iOS id is in `app.json` and `GOOGLE_NATIVE_CLIENT_IDS`.
