# Handoff (4 Nov 2026): Mac → Linux

Work on JoyoArto moved from the Mac (T3 Code) to the Linux box (`linuxbox`, claude-hub).
Start a session in `~/Documents/JoyoDigitama/joyoarto` with `claude-hub`, then read this file, README.md, AGENTS.md and
the Atur project **BRK** (workspace `joyodigitama`).

## Where things are

| What | Where |
| --- | --- |
| Code | github.com/dzulfikar08/joyoarto (renamed from `baroka`; packages and the Worker are still named `baroka`) |
| Production | app: https://app.arto.joyorogo.com · landing: https://arto.joyorogo.com · old https://baroka.by.dzulfikar.com redirects |
| Deploys | GitHub Actions: `ci.yml` → `deploy.yml` (D1 migrations + `wrangler deploy` + smoke test). Secret `CLOUDFLARE_API_TOKEN` in environment `production`. Don't deploy from a laptop. |
| iOS | `release-ios.yml` (manual, environment `release`, macOS runner) builds the IPA and optionally uploads it to TestFlight; secrets and steps in `docs/ios-release.md`. Not run yet. |
| Android | `android.yml` builds the APK artifact `joyoarto-android-apk` (`gh run download <id> -n joyoarto-android-apk`). Release signing secrets (`ANDROID_KEYSTORE_*`) not set yet: debug-signed. |
| MCP | claude-hub has `joyoarto` (https://app.arto.joyorogo.com/mcp, its own `brk_` token) and `atur`. |
| Task tracking | Atur project BRK (Backlog/Todo/In Progress/Done/Cancelled). |

## Working rules (from the owner)

- Never build or deploy on the laptops; push to main and let Actions do it.
- Keep work moving: put multi-step builds on background agents (one schema-migration owner at a time), merge, push, and file everything in Atur BRK.
- Every finance query is scoped by `householdId` (see CLAUDE.md).

## Open items

1. **Email-in routing:** Cloudflare Email Routing is enabled for `arto.joyorogo.com` and subaddressing is on for joyorogo.com. **Missing:** a routing rule `import@arto.joyorogo.com` → *Send to a Worker* → `baroka` (dash → joyorogo.com → Email Routing → Routing rules). Then turn the address on in Settings → Import by email and forward a PDF to test it.
2. **Android app v1:** the first CI build is running or done. Install it on a real phone and check:
   - notification capture with real Jago/GoPay notifications (add the real texts to `apps/mobile/src/capture/parsers/samples.ts`);
   - "Allow restricted settings" on Android 13+;
   - share PDF → `/api/imports/statement-file`.
   - Later: release keystore secrets; OAuth sign-in (needs a `joyoarto://` redirect, and REST must accept OAuth access tokens).
3. **README rewrite with screenshots:** take them from production using a demo household (never the owner's real data). Cover the phone and desktop dashboard, transactions, import, plan, Joyo AI and the Claude connector.
4. **Uncategorized transactions (about 29):** ask the owner about the remaining merchants and personal transfers (see `search_transactions uncategorized=true` in the live ledger; never list counterparties in the repo).
5. **Backlog in Atur:** BCA PDF parser (waiting on a sample), Plan upgrade-path UX, shorter share links, BCA CSV check against a real export, Cloudflare WAF skip for /api and /mcp, audit pruning cron, own Google OAuth brand.
6. **Joyo Pro (built, not live).** JoyoArto no longer sells anything: Joyo Pro is one subscription per account, sold by
   JoyoRogo (the only billing authority) and shared by JoyoRogo, JoyoFit and JoyoArto (README "JoyoArto Pro"). Before
   limits go live:
   - JoyoRogo must deploy `POST /api/internal/joyo-pro/status` (header `x-joyo-internal-key`, body
     `{ googleSub?, email }`, answer `{ pro, until, plan, source }`, 401 on a wrong key) and accept `?from=joyoarto` on
     `/pro`. A return URL back to JoyoArto after paying would be nice; JoyoRogo's `/pro` only takes a same-site `next` today.
   - Generate one random key and set it as the Worker secret `JOYO_INTERNAL_KEY` on **both** Workers (JoyoArto's
     `baroka` and JoyoRogo's server): `wrangler secret put JOYO_INTERNAL_KEY`. `PAYWALL` is already `"1"` in
     wrangler.jsonc, so setting the key turns the Free limits on.
   - Both apps must keep signing in with the same Google OAuth client (they do today), or `googleSub` stops matching and
     only the verified email is left.
   - No grandfathering (owner's decision, 4 Nov 2026): accounts without Joyo Pro get the 14-day trial only; existing
     Joyo Pro members (JoyoRogo/JoyoFit) are Pro in JoyoArto right away.
   - Migrations 0009/0010 drop the old household billing tables (never used in production: no gateway secrets were set)
     and add `joyo_pro_status` and a per-user `usage_counter`. `deploy.yml` applies them. Remove any old `DOKU_*` /
     `POLAR_*` secrets from the `baroka` Worker if they were ever set.
7. **Phone app purchases (later, don't build yet).** When the JoyoArto Android/iOS app sells Joyo Pro in-app, do it the
   way JoyoFit does: the app buys JoyoRogo's store products with Play Billing / StoreKit, then posts the purchase to
   **JoyoRogo's** `POST /api/billing/google` (`{ purchaseToken, packageName: "com.joyodigitama.joyoarto" }`) and
   `POST /api/billing/apple`. JoyoRogo verifies, credits the account and answers; JoyoArto then sees Pro through the
   status call. On JoyoRogo's side that needs: the JoyoArto package in `GOOGLE_PLAY_PRODUCTS` / `GOOGLE_PLAY_PACKAGE_NAMES`
   and its bundle id in `APPLE_PRODUCTS` / `APPLE_BUNDLE_IDS`, store products created in the JoyoArto app listings, the
   Play service account invited to the JoyoArto app, RTDN pointed at the same topic, and the App Store notification URL
   set to JoyoRogo's `/api/billing/apple/notifications` (JoyoRogo docs/play-billing.md section 4 and billing-status.md).
   The app must call JoyoRogo with a JoyoRogo session (same Google account), not JoyoArto's.
8. **iOS app: TestFlight** (workflow, config and docs done; see `docs/ios-release.md`). Owner steps, in order:
   1. **Secrets.** On the Linux box, set the five `release` environment secrets of `dzulfikar08/joyoarto` with the
      commands in `docs/ios-release.md` "Secrets": `ASC_KEY_BASE64` (`~/Downloads/AuthKey_BUU2CPKLGM.p8`), `ASC_KEY_ID`
      (`BUU2CPKLGM`), `ASC_ISSUER_ID` (`9e34111d-e39f-4122-9000-6eb4628fe9b9`), `IOS_DIST_CERT_P12_BASE64` and
      `IOS_DIST_CERT_PASSWORD` (a new `.p12` from `~/.config/joyorogo-ios/distribution/{cert.der,key.pem}`).
   2. **Bundle id** (developer.apple.com, Certificates, Identifiers & Profiles, Identifiers, +, App IDs, App): explicit
      `com.joyodigitama.joyoarto`, description `JoyoArto`, **no capabilities** (no App Groups: the share extension is
      not built; no push). Optional: the workflow's `asc-ci-profile.py` registers it by itself on the first run.
   3. **App Store Connect app** (appstoreconnect.apple.com, Apps, +, New App): platform iOS, name
      `JoyoArto: Keuangan Keluarga`, primary language **Indonesian**, bundle id `com.joyodigitama.joyoarto`, SKU
      `joyoarto`, user access Full. Then App Information: category Finance; Pricing and Availability: Free.
   4. **Dry run, then upload.** `gh workflow run release-ios.yml -R dzulfikar08/joyoarto -f upload_testflight=false`,
      approve the `release` deployment, check it is green; then the same with `-f upload_testflight=true`. Wait for the
      build to finish processing in TestFlight.
   5. **Export compliance**: nothing to answer (`ITSAppUsesNonExemptEncryption` is false in the build). If a build
      still shows "Missing Compliance": encryption yes, exempt (HTTPS only) yes.
   6. **Internal group** (TestFlight, Internal Testing, +): `Internal`, tick "Enable automatic distribution", add
      yourself (and household testers who are App Store Connect users).
   7. **Beta App Review information** (TestFlight, Test Information): feedback email, privacy policy
      `https://arto.joyorogo.com/privasi`, sign-in required, the demo login (`<REVIEW_DEMO_CODE>`, the review code the
      other agent is adding; never commit it) and the notes text from `docs/ios-release.md`. Make the demo account Pro
      (or give it a long trial) so the reviewer hits no Free limit.
   8. **External group with a public link** (TestFlight, External Testing, +): `Publik`, add the build, submit it for
      Beta App Review (first build only takes about a day), then **Enable Public Link** (tester limit as you like).
   9. **App Privacy** (App Store Connect, App Privacy, Get Started): the answers table in `docs/ios-release.md`
      (name, email, other financial info, user id; linked, app functionality, no tracking), privacy policy URL
      `https://arto.joyorogo.com/privasi`. Publish.
   - Follow-ups: the iOS share extension (`docs/ios-release.md` "Share extension"); App Store release needs a version
     bump, 6.9" screenshots from a demo household, review notes, and a decision on In-App Purchase for Joyo Pro
     (`docs/ios-release.md` "Joyo Pro and App Review": first review with no purchase UI or link out, then JoyoFit's
     StoreKit flow through JoyoRogo if Apple asks).
