# iOS: TestFlight and the App Store

Written 2026-11-04. The JoyoArto iPhone app (`apps/mobile`, bundle id `com.joyodigitama.joyoarto`, Apple team
`F6Q6UFUK69`) is built and uploaded by GitHub Actions the same way JoyoRogo is (JoyoRogo `docs/ci-release.md`,
`docs/ios-mac.md`). Nothing is built on a laptop. The repo is public, so the macOS runner costs nothing.

| Piece | File |
| --- | --- |
| Workflow (manual, environment `release`, `macos-latest`) | `.github/workflows/release-ios.yml` |
| Build script: prebuild, pods, archive, export, IPA checks, optional altool upload | `apps/mobile/scripts/ios/build-ios.sh` |
| App Store profile from the App Store Connect API (copied from JoyoRogo, keep in step) | `apps/mobile/scripts/ios/asc-ci-profile.py` |
| iOS config: bundle id, team, export compliance, ATS, privacy manifest, plugins | `apps/mobile/app.json` |

## Running it

```bash
gh workflow run release-ios.yml -R dzulfikar08/joyoarto -f upload_testflight=false   # IPA artifact only (dry run)
gh workflow run release-ios.yml -R dzulfikar08/joyoarto -f upload_testflight=true    # ...and upload to TestFlight
```

Then approve it: run page, **Review deployments**, tick `release`, Approve (the same `release` environment as
`release-android.yml`: required reviewer, `main` only). The IPA is the artifact `joyoarto-ios-<run>` (30 days); logs,
signing plists and the merged privacy manifest are `joyoarto-ios-logs-<run>` (7 days).

- **Build number** (`CFBundleVersion`): `YYYYMMDDHHMM` in UTC at build time, like JoyoRogo. `BUILD_NUMBER` overrides it.
- **Version** (`CFBundleShortVersionString`): `expo.version` in `app.json` (now `0.1.0`, shared with Android's
  versionName). Bump it before an App Store release (for example to `1.0.0`); TestFlight builds can share a version.
- **Upload**: `xcrun altool --upload-app` with the API key. App Store Connect then processes the build (about 5 to 30
  minutes) and it appears under TestFlight. The upload fails until the App Store Connect app record exists (owner step 2
  below).
- **Xcode**: `latest-stable` on the runner (input `xcode_version` picks another). Uploads need Xcode 26 / the iOS 26
  SDK or later; the script refuses an older SDK.

## Secrets (environment `release` of dzulfikar08/joyoarto)

The same App Store Connect API key and Apple Distribution certificate as JoyoRogo, under the same names. GitHub secrets
cannot be read back, so they are set again from their source files on the Linux box (`linuxbox`), the machine
JoyoRogo's docs refer to as "the laptop". Run there:

| Secret | Value | Source on the Linux box |
| --- | --- | --- |
| `ASC_KEY_BASE64` | base64 of the `.p8` key | `~/Downloads/AuthKey_BUU2CPKLGM.p8` (JoyoRogo `docs/ci-release.md`; `~/.appstoreconnect/private_keys/AuthKey_BUU2CPKLGM.p8` if it was moved) |
| `ASC_KEY_ID` | `BUU2CPKLGM` | the key's id (file name) |
| `ASC_ISSUER_ID` | `9e34111d-e39f-4122-9000-6eb4628fe9b9` | App Store Connect, Users and Access, Integrations, Team Keys (also JoyoRogo `scripts/ios/mac-build.sh`) |
| `IOS_DIST_CERT_P12_BASE64` | base64 of a `.p12` of the Apple Distribution identity | made from `~/.config/joyorogo-ios/distribution/cert.der` and `key.pem` (the Linux pipeline's certificate, expires 2027-10-15) |
| `IOS_DIST_CERT_PASSWORD` | the `.p12` password | the random password you make below |

No provisioning-profile secret: the job fetches (or creates) the App Store profile `joyo-ci com.joyodigitama.joyoarto
<cert id>` through the API on every run, registers the bundle id if it does not exist yet, and enables Sign in with Apple
(`APPLE_ID_AUTH`) on it. The key id and issuer id
are identifiers, not secrets (JoyoRogo's public repo has them too); they are secrets here only so the workflow reads
everything from one place.

```bash
R=dzulfikar08/joyoarto
base64 -w0 ~/Downloads/AuthKey_BUU2CPKLGM.p8 | gh secret set ASC_KEY_BASE64 --env release -R $R
printf %s BUU2CPKLGM | gh secret set ASC_KEY_ID --env release -R $R
printf %s 9e34111d-e39f-4122-9000-6eb4628fe9b9 | gh secret set ASC_ISSUER_ID --env release -R $R

# A .p12 of the same certificate and key JoyoRogo's CI uses, with a new random password (JoyoRogo's secrets are
# untouched). Old algorithms on purpose: macOS `security import` needs them.
cd ~/.config/joyorogo-ios/distribution
pw=$(openssl rand -hex 16)
openssl x509 -inform der -in cert.der -out /tmp/cert.pem
openssl pkcs12 -export -inkey key.pem -in /tmp/cert.pem -out /tmp/dist.p12 -name "Apple Distribution" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -password pass:$pw
base64 -w0 /tmp/dist.p12 | gh secret set IOS_DIST_CERT_P12_BASE64 --env release -R $R
printf %s "$pw" | gh secret set IOS_DIST_CERT_PASSWORD --env release -R $R
shred -u /tmp/dist.p12 /tmp/cert.pem; unset pw

gh secret list --env release -R $R
```

The first workflow step fails with the list of missing names if any of the five is not set.

## Signing

Same split as JoyoRogo, because a fresh runner has no keychain identity, the API key may not create a cloud-managed
distribution certificate ("Cloud signing permission error") and the team already has Apple's maximum of three Apple
Distribution certificates:

1. The `.p12` goes into a temporary keychain; `asc-ci-profile.py` finds that certificate on App Store Connect by serial
   and reuses or creates the App Store profile for `com.joyodigitama.joyoarto`.
2. `build-ios.sh` sets the `JoyoArto` target to manual signing with that identity and profile (only that target, not
   the Pods), archives and exports with `ExportOptions.plist` (`app-store-connect`, manual). xcodebuild never signs in
   to the account (JoyoRogo saw that login fail on 2026-10-24 while the REST API worked).
3. Without `EXPORT_PROFILE` the script signs automatically through the API key instead (needs cloud-signing rights;
   not used in CI).

Keychain, key and profile are removed in the last `always()` step. The `.p12` is never written outside `$RUNNER_TEMP`.

## IPA checks (the job fails on any)

Bundle id; `CFBundleVersion` equals the build number; display name `JoyoArto`; `ITSAppUsesNonExemptEncryption` false;
ATS without arbitrary loads; iOS 26 SDK or later; **exactly one permission text, `NSMicrophoneUsageDescription`**
(voice quick add; at least 40 characters, Indonesian in the base Info.plist, and translated in `id.lproj` and
`en.lproj/InfoPlist.strings` from app.json `locales`), no other `NS*UsageDescription` key and no `audio` background mode;
no embedded extensions; `PrivacyInfo.xcprivacy` present, `NSPrivacyTracking` false, and entries for
UserDefaults, FileTimestamp, SystemBootTime and DiskSpace; App Store profile without devices; `get-task-allow` false;
signature verifies with an Apple Distribution identity; no `NotificationCaptureModule` in the executable; embedded
`app.config` matches `expo config`; `main.jsbundle` has app code and the API URL `https://app.arto.joyorogo.com`.

## What is in the iOS app

- **Same JS app as Android**: Sign in with Apple, Google sign-in (once the iOS OAuth client exists,
  `docs/mobile-auth.md`), token and demo sign-in, the dashboard, transactions, the add sheet, statement PDF import with
  the document picker (`expo-document-picker`, needs no permission text).
- **Sign in with Apple** (guideline 4.8, because Google sign-in is offered): the `com.apple.developer.applesignin`
  entitlement (`ios.usesAppleSignIn`), and the workflow enables the `APPLE_ID_AUTH` capability on the bundle id before
  it makes the profile. The IPA check fails without the entitlement.
- **Notification capture is Android only.** `modules/notification-capture/expo-module.config.json` lists only
  `android`, so iOS autolinking never adds it; the JS reads it with `requireOptionalNativeModule` (null on iOS) and
  hides the screens (`Platform.OS === "android"`). The IPA check above proves it stays out.
- **One permission prompt: the microphone**, for voice quick add ("Say it" in the add sheet, `src/lib/voice.ts`). It is
  asked the first time the member taps the mic, never at launch. Text (app.json `expo-audio` plugin, base Info.plist,
  bilingual) and translations (`apps/mobile/locales/id.json`, `en.json`, shown in the phone's language):
  - id: "JoyoArto memakai mikrofon hanya saat kamu merekam catatan suara untuk mencatat transaksi (maks. 60 detik).
    Rekaman dikirim ke server JoyoArto untuk diubah jadi teks lalu dihapus, tidak disimpan."
  - en: "JoyoArto uses the microphone only while you record a voice note to add a transaction (up to 60 seconds). The
    recording is sent to JoyoArto's server to turn it into text and is then deleted, never stored."

  No background audio (`enableBackgroundPlayback` / `enableBackgroundRecording` false: recording stops when the sheet
  closes). No camera, photos, location or contacts. `expo-secure-store`'s default Face ID text is removed (`faceIDPermission:
  false`); the token is in the Keychain without biometrics. expo-dev-client's Bonjour and local-network keys are
  deleted from the release Info.plist by the build script (the dev launcher only runs in Debug).
- **Export compliance**: `ios.config.usesNonExemptEncryption: false` writes `ITSAppUsesNonExemptEncryption = NO`. The
  app only uses HTTPS (Apple's exempt case), so App Store Connect asks nothing per build.
- **Privacy manifest**: prebuild writes `PrivacyInfo.xcprivacy` from `ios.privacyManifests` in `app.json` (no
  tracking, no tracking domains; collected: other financial info, user id, name, email address, all linked to the user,
  for app functionality only; required-reason APIs: UserDefaults `CA92.1`, FileTimestamp `C617.1` `0A2A.1` `3B52.1`,
  SystemBootTime `35F9.1`, DiskSpace `E174.1` `85F4.1`, the set Expo and React Native use). React Native's pod install
  then merges every pod's own manifest into it (`privacy_file_aggregation_enabled`, on by default). JoyoRogo relies on
  that merge alone; JoyoArto adds the explicit baseline so the file exists even if a pod ships none. The merged file is
  in the logs artifact.
- **No purchase UI and no link out** (see "Joyo Pro and App Review" below): on iOS (`src/lib/platform.ts`
  `storeSafe`) a Free-plan limit shows "This is not included in this account's plan. Nothing was changed." instead of
  the server's "Joyo Pro (bought in JoyoRogo …)" text, and the sign-in screen names Settings, API tokens as plain text
  instead of a button that opens the web app.
- iPhone only (`supportsTablet: false`), portrait, iOS 16.4 or later (as JoyoRogo).

### Share extension (follow-up, not built)

`expo-share-intent` can add an iOS share extension (PDF from Files or Mail, Share, JoyoArto). It is **off on iOS**
(`disableIOS: true`); Android keeps the PDF share target, and on iPhone the Import screen's document picker opens the
same PDFs from Files. Turning it on needs:

1. a second bundle id `com.joyodigitama.joyoarto.share-extension` and the App Group `group.com.joyodigitama.joyoarto`,
   assigned in the developer portal to **both** bundle ids (the API cannot assign a group);
2. the workflow to fetch a second profile (`asc-ci-profile.py … APP_GROUPS` for both ids, as JoyoRogo's widget does)
   and `build-ios.sh` to sign the `ShareExtension` target with it (JoyoRogo's `mac-build.sh` per-target block) and check
   the `.appex` and the App Group in both entitlements;
3. drop `disableIOS`, keep `iosActivationRules` (`NSExtensionActivationSupportsFileWithMaxCount: 10`), and test that
   `app/+native-intent.tsx` routes `joyoarto://dataUrl=…` to `/import` on a real iPhone.

JoyoRogo has the two-target signing pattern (widget extension, `docs/ios-widget.md`) but no share extension, so this is
left for after the first TestFlight build works.

## Apple-side one-time steps

The ordered checklist is in `docs/HANDOFF.md` ("iOS app: TestFlight"). Notes for those steps:

**Names.** App Store Connect app name `JoyoArto: Keuangan Keluarga` (27 of 30 characters), primary language
Indonesian, SKU `joyoarto`, bundle id `com.joyodigitama.joyoarto`. The home-screen name stays `JoyoArto`
(`CFBundleDisplayName`). Suggested subtitle (id): `Catat, impor mutasi, rencana`; (en-US): `Track, import, plan together`.
Category Finance. Price Free.

**Beta App Review information** (needed for the external group): contact the owner; sign-in required **yes**. The
app's main sign-in is Sign in with Apple / Google, which a reviewer cannot use with an invite-only service, so the review
login is the demo code:

```
User name: demo
Password:  <REVIEW_DEMO_CODE>   (the demo household's secret code, DEMO_LOGIN_CODE; never commit it)
Notes:     JoyoArto is a household finance ledger and is invite-only. To review it, on the sign-in screen tap
           "Coba demo / Reviewer", type the code above and tap "Masuk ke demo / Open the demo". The account is a demo
           household with made-up bank accounts and transactions (reset daily). Try: Home (this month, spending by
           category, cash flow, balances), Transactions (search, filters, tap a category to change it), the + button
           (type "kopi 25rb gopay", review, Save), More → Import (pick a PDF bank statement from Files; a sample Bank
           Jago statement is at <SAMPLE_PDF_URL>). Sign in with Apple and Google sign-in work for invited members.
           Notification capture is an Android feature and is not in the iPhone app. Nothing is sold in the app.
```

Replace the two placeholders before submitting.

**Export compliance.** Answered by the Info.plist key: builds show "No" for encryption without a question. If App
Store Connect still asks (first build of a new app sometimes does): "Does your app use encryption?" Yes, only
standard HTTPS / exempt; "Is it exempt?" Yes (Category 5 Part 2 exemption for authentication and HTTPS). No documents
to upload, and no French declaration.

**App Privacy** (App Store Connect, App Privacy), matching https://arto.joyorogo.com/privasi:

| Question | Answer |
| --- | --- |
| Do you or your partners collect data from this app? | Yes |
| Contact Info: Name, Email Address | Collected, linked to the user, App Functionality only, not used for tracking |
| Financial Info: Other Financial Info (accounts, transactions, balances, statements' parsed rows) | Collected, linked, App Functionality only, not tracking |
| Identifiers: User ID | Collected, linked, App Functionality only, not tracking |
| User Content: Audio Data (voice quick add) | **Not collected** in Apple's sense: the voice note is sent to JoyoArto's server only to turn it into text for that one request (Cloudflare Workers AI Whisper, `packages/api/src/services/capture.ts`), then dropped; neither the audio nor the transcript is stored or logged, and the phone deletes its copy after sending. Apple counts data as collected only when it is kept longer than needed to answer the request in real time. If transcripts or audio are ever stored, change this row to Collected, linked, App Functionality. |
| User Content (other), Usage Data, Diagnostics, Location, Contacts, Health, Browsing, Search, Purchases, Sensitive Info | Not collected (no analytics, no crash reporting, no ads; payments are not taken in JoyoArto) |
| Tracking (App Tracking Transparency) | No: no data is used for tracking, no data brokers, no ads |

Notes: "Financial Info" in Apple's list also has payment info / credit info; neither applies (only the last four digits of
an account, which is account metadata, are kept). Payment info is not collected because JoyoArto never takes payments.
Privacy policy URL `https://arto.joyorogo.com/privasi`; it already covers the phone app's data (finance records,
tokens, the Keychain-stored token is on the device only). It already covers voice notes (sent to Cloudflare Workers AI
for transcription, processed and discarded; recordings and transcripts not stored) and Joyo AI, so it needs no change
for voice quick add. Joyo AI chat in the app sends questions and the ledger data it reads to the AI provider, the same as the web
(questions and answers are stored per member as conversations: already "Other Financial Info"/linked; review this when
the chat ships to TestFlight). If analytics are ever added, update this table, the privacy manifest and the policy
together.

**Google Play Data safety** (same change): Audio, "Voice or sound recordings": collected, **processed ephemerally**,
not shared (Cloudflare processes it for us as a service provider), optional (the member can type instead), purpose App
functionality. Android shows no usage text of its own, so the add sheet explains the microphone in the app (English and
Indonesian) before and after the system prompt.

## From TestFlight to the App Store

What a first App Store submission needs beyond a TestFlight build:

1. **Version** in `app.json` raised (e.g. `1.0.0`), a build of it uploaded, and attached to the App Store version.
2. **Screenshots**: iPhone only (`supportsTablet: false`, so no iPad set). One set at **6.9"** (1320x2868 or 1290x2796
   portrait) is enough; App Store Connect scales it for smaller iPhones. 3 to 10 per locale. Take them from a demo
   household, never real data (README rewrite item in HANDOFF): Home with balances, quick add, Import with a parsed
   statement preview, Captured/transactions. JoyoFit made framed captures (its `docs/app-store.md`); real iPhone
   screenshots from a TestFlight build are better.
3. **Description, keywords, promotional text, support URL** (`https://arto.joyorogo.com`), marketing URL, privacy URL,
   copyright `2026 Dzulfikar Ats Tsauri`, age rating questionnaire (no objectionable content: 4+; "Unrestricted web
   access" no; "Gambling" no; financial info is not a rating factor).
4. **App Review notes**: the same demo login and notes as Beta App Review, plus the business-model paragraph below.
5. **Account deletion (5.1.1(v))**: only required when the app can create accounts. The iOS app cannot (accounts are made
   on the web with Google); say so in the notes, and that deletion is in the web app's Settings, Data & privacy.
   If sign-up ever moves into the app, an in-app delete path is required.
6. **Sign in with Apple (4.8)**: not needed while sign-in is a token. When OAuth with Google lands in the app (HANDOFF
   Android item), the app must also offer Sign in with Apple or another login that meets 4.8, like JoyoRogo does.
7. **Minimum functionality (4.2)** risk: a token-only sign-in can read as "a web wrapper / requires an account from
   elsewhere". The notes should say what the app does on its own (quick add on the go, statement import from Files,
   offline queue).

### Joyo Pro and App Review

Joyo Pro is one subscription per account, sold only by JoyoRogo (web, JoyoRogo's iOS app with In-App Purchase, Google
Play). JoyoArto unlocks it when the same Google account has it.

Apple's rules that apply:

- **3.1.1**: features unlocked in the app must be bought with In-App Purchase; the app may not include buttons, external
  links or other calls to action that direct people to other purchase methods.
- **3.1.3(b) Multiplatform services**: an app may give access to content or subscriptions bought elsewhere (other
  platforms, the web, another app of the developer) **provided those items are also available as In-App Purchase in
  the app**.
- **3.1.3(a) Reader apps** (magazines, music, video, books, cloud storage...) may skip In-App Purchase and get one
  external link entitlement. A finance ledger with paid tools is not a reader app; do not rely on it.

How the siblings handle it:

- **JoyoRogo** sells Pro with its own StoreKit products on iOS (`com.joyodigitama.joyorogo.founder.monthly/.yearly`),
  shows no link or web mention in the iOS app, and the server keeps sandbox and review accounts apart (JoyoRogo
  `docs/pricing.md`, `docs/billing-status.md`).
- **JoyoFit** first shipped with a "JoyoRogo Pro" upgrade card and no In-App Purchase; its 2026-10-28 rejection asked for
  the business model (2.1(b)). The owner then added JoyoFit's own StoreKit products that grant the same JoyoRogo Pro
  (`com.joyodigitama.joyofit.pro.monthly/.yearly`, posted to JoyoRogo's `/api/billing/apple`) and answered under
  3.1.1 / 3.1.3(b): "nothing is sold outside In-App Purchase in the app; Pro bought elsewhere is honoured; never a
  link out" (JoyoFit `docs/app-store.md`, `docs/pro-ios.md`).

**Recommendation for JoyoArto's first App Store review:**

1. Ship the iOS app **without any purchase UI, price, upgrade card or link out** (done in code: `storeSafe`). Free
   limits stay enforced by the server; on iOS they read as a neutral "not included in this account's plan".
2. Do not mention Joyo Pro, prices or JoyoRogo's shop in the App Store description or screenshots.
3. Expect App Review to ask (2.1(b)) whether paid features exist, because a Free account hits limits (2 statement
   imports a month, saved scenarios, the Claude connector). Answer plainly: the app itself sells nothing; some features
   of the account are part of a subscription sold in our other app and on the web, which users may already have
   (3.1.3(b)). If Apple then insists on In-App Purchase (the JoyoFit precedent says it will, sooner or later), do the
   JoyoFit flow: JoyoArto's own StoreKit products in the JoyoArto app record, posted to JoyoRogo's
   `POST /api/billing/apple` (HANDOFF item "Phone app purchases"). That is the durable answer and should be planned
   before a public App Store release that markets Pro.
4. Safer alternative for the review account: make the demo household Pro (on `PRO_EMAILS` or a long trial), so the
   reviewer never hits a limit, and say in the notes that nothing is purchasable in the app.

Sources: App Store Review Guidelines 3.1.1, 3.1.3(a), 3.1.3(b), 4.8, 5.1.1(v), 2.1
(https://developer.apple.com/app-store/review/guidelines/), and the JoyoFit review history above. Apple's wording
changes; reread 3.1 before the first submission.
