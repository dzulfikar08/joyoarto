<img src="assets/icon.svg" width="64" height="64" alt="">

# JoyoArto

> **JoyoArto** (formerly *baroka*) is part of the Joyo family of apps (JoyoRogo, JoyoFit). The codebase still uses the
> name `baroka` internally: package names (`@baroka/*`), the Cloudflare Worker and D1 database (`baroka`), the API
> token prefix (`brk_`), localStorage keys and the current domain. JoyoArto is not affiliated with any bank or e-wallet.

Personal finance ledger built to be used through Claude. Bank, card and e-wallet transactions live in one household
ledger that you can reach three ways: an MCP server (claude.ai connector, Claude Desktop, Claude Code), a REST API with
OpenAPI docs, and a lean web app for imports and review.

## Layout

| Path | What |
| --- | --- |
| `packages/db` | Drizzle schema (D1/SQLite) and migrations. Finance data is scoped by **household**, not user; family members join by invite. |
| `packages/api` | Domain logic (`lib/`: money, CSV mappings, merchant cleanup, dedupe, rules), services, and the oRPC router. Every procedure has a REST route. |
| `packages/auth` | better-auth: Google sign-in, dev login, OAuth 2.1 provider for the MCP connector. |
| `apps/server` | Hono on Cloudflare Workers: `/rpc` (web app), `/api/*` (REST, docs at `/api/docs`), `/mcp`, `/api/auth/*`. |
| `packages/ui` | Design system (`@baroka/ui`): JoyoArto tokens on the JoyoRogo v2 base (Plus Jakarta Sans, warm paper canvas, arto-blue primary, gold coin accent), shadcn-style components on Base UI, sonner toasts, theme hook. |
| `apps/mobile` | Expo (SDK 58, dev build) + react-native-unistyles: the phone app (Android first, iOS via TestFlight). Google / Apple sign-in, the web's dashboard, transactions and add sheet behind a floating tab bar, notification capture (Jago/GoPay) and statement PDFs. Conventions: `apps/mobile/AGENTS.md`. |
| `apps/web` | Vite + TanStack Router: dashboard (`/`, one `reports.dashboard` call per month), transactions (filters in the URL), import/review, accounts, settings (household, members, tokens), `/join/<token>` (invites), `/connect` (OAuth consent). |

## Conventions

- Money is an integer in minor units with a currency (IDR exponent 2: Rp 25.000 = `2500000`). Amounts are signed from
  the account's view: negative = money out. API results carry a `display` string too.
- Transaction dates are calendar days (`YYYY-MM-DD`) as printed on the statement.
- The bank's description is never edited; `merchant` is the cleaned-up, editable name.
- Imports are idempotent: each row's key hashes account, date, amount, description and its occurrence among identical
  rows, so re-importing or overlapping statements adds nothing twice.
- D1 allows at most 100 bound parameters per statement. Anything sized by the caller goes through `chunk` /
  `rowsPerInsert` in `packages/api/src/lib/d1.ts`.

## Households and invites

An owner invites an email address in Settings and sends the link (`/join/<token>`, shown once, valid 14 days; only its
SHA-256 hash is stored). A pending invite also lets that address sign up when it is not on `ALLOWED_EMAILS`. Accepting
needs the invited Google account, adds the membership and makes that household active; the invitee's own personal
household is deleted when it is still empty (no accounts, transactions or other members). A user in several households
picks the active one in Settings (`household_member.is_default`); sessions, API tokens and AI connections all act in it.

## Plan & simulate

`/plan` (and the MCP tools `plan_baseline`, `plan_templates`, `simulate_plan`, `compare_plans`) answers "can we afford
this?" from the ledger. The baseline uses the last complete months (default 6), but none before the household's first
full month (the month of its first transaction, or the next one when that came after the 7th), so a new household's
empty months do not halve its income and spending; `history` reports the months used and `tooLittle` under 2 of them.
Recurring income (gifts, refunds, other income and sources in under half the months left out; salary paid at month end
for the next month is re-attributed), core spending without one-offs above max(Rp 2 jt, 25% of the month) and without
the refunds that offset them (same top-level category, ±31 days, at least half the one-off; the plan uses the higher
of core average and median), existing installments (outgoing transfers for the household's own debt such as
cicilan/KPR/paylater, net of money paid back, in at least half the months; money lent to family and card-bill payments
are not counted), and liquid balances by role (emergency, goal, spending). Scenarios (car loans with flat or effective
rates or the dealer's quoted installment, one-offs, monthly costs, income changes) are projected month by month and
judged by explicit rules (emergency fund ≥ 6 months of outflow, installments ≤ 30% of income and car ≤ 20%, no
negative balance). All maths is pure in `packages/api/src/lib/plan/`.

- **Upgrade path**: a loan can have a `sale` (after N months, at a resale % or amount). From the sale month it costs
  nothing; the sale price first settles the outstanding principal (declining-balance schedule at the loan's effective
  rate, the implied one for flat loans, plus any early-settlement penalty) and the rest goes to `proceedsTo`. Add the
  next car as another loan in the sale month (template `carUpgrade`: Wuling Aira EV LR now, Geely EX2 Max after 18
  months). The default resale is an assumption for battery EVs in Indonesia (`lib/plan/resale.ts`): 35% of the OTR
  price lost in year one, 10% a year after, at least 15% left (65% after 12 months, 60% after 18).
- **Where to save** ("Bisa hemat di mana", `GET /api/plan/savings`, oRPC `plan.savings`, MCP `spending_cuts`; rules in
  `lib/plan/savings.ts`): everyday habits from the same complete months as the baseline (which start at the household's
  first full month). Habits are `food/coffee`, `food/snacks`, `food/dining`, `food/delivery`, `transport/ride-hailing`
  and `shopping/online` with their children (by slug, so a renamed category keeps working; slugs the household lacks
  are listed as missing), plus minimarket snacks: Indomaret, Alfamart, Alfamidi, Lawson, FamilyMart and Circle K
  baskets up to Rp 100.000 (`minimarketMax`) in any other category. A row counts once (habit category first). Only
  expenses count: no transfers, no reimbursable rows until rejected, no one-offs the baseline leaves out. Per habit:
  purchases per week and month, average ticket, monthly spend, share of recurring income, trend (last month, or the last
  three with six months, against the earlier ones; ±15% is up/down) and top merchants. With at least 2 months and 4
  purchases a month it suggests a cut: a frequency (per week from 1.5 a week, else per month; one less, a third less
  from four on), saving = purchases dropped a month × average ticket; shopping gets a monthly cap (75/50/25% of the
  average, tidied). Members pick a target per habit (`targets`, `null` keeps a habit). The chosen cuts become `cut`
  scenario items (`cut:<habit>`) that lower core spending in the simulator; the response's `effect` runs the plan with
  and without them and reports months sooner for the emergency fund target, a `goalAmount` and rebuilt goal savings,
  plus rules that turn from failing to passing. Only the household's own history and income are compared. On `/plan`
  the block adds the cuts to a scenario (or a new one); the dashboard shows the top two.
- **Saved scenarios** (`plan_scenario`, `plan.scenarios.*`, MCP `list_scenarios` / `save_scenario` /
  `delete_scenario`) belong to the household, so both partners see and edit the same list. A row keeps the planner
  input (items plus baseline overrides, validated by `savedPlan`) and, from the web page, its block layout (`view`,
  cleared whenever another client saves the items). `simulate_plan` takes a `scenarioId` (call fields override the
  saved ones); `compare_plans` takes `scenarios[].scenarioId` and runs the saved items against the call's baseline. The
  web page itself is an unsaved draft in localStorage and shares via the URL hash (without saved-scenario links).

## Statements JoyoArto reads itself

`packages/api/src/lib/statements/` parses **Bank Jago** monthly statements and **GoPay** e-statements from their PDF
text. Three ways in:

- the web app extracts the text in the browser with pdf.js and sends it (`POST /api/imports/statement`; the MCP tool
  `import_statement_text` takes text too);
- `POST /api/imports/statement-file` (oRPC `imports.statementFile`, `finance:write`) takes the PDF itself as
  `multipart/form-data`: field `file`, optional `commit` (`"true"`/`"false"`, default false), `Authorization: Bearer brk_…`.
  The JSON answer is the same as `/imports/statement`'s; a password-protected PDF is a 400 with `data.reason:
  "encrypted"` (`"invalid"` for a file that is not a readable PDF). The Android app uses this;
- email (below).

Server and browser produce the same lines: both run `lib/pdf/lines.ts` on pdf.js text items, and the web app's
`pdfjs-dist` is pinned to the pdf.js version inside `unpdf` (the Worker's build); `lib/pdf/pdf.test.ts` fails when
they differ or when the two extractions of the same PDF do not match. Upgrade them together.

- Jago: one account per pocket (matched by the pocket id's last four digits, created on first import with the
  statement's previous balance). Every running balance and pocket total must add up, or nothing is saved.
  Statements may arrive in any order.
- GoPay: the real merchant behind each Jago "Gopay - Generic" payment, matched on GoPay's transaction id (stored as
  `transaction.payment_ref` and `payment_hint`, so either statement can come first). Payments from GoPay balance go to
  a "GoPay wallet" account.
- Household rules run first and win; `classify.ts` only suggests what the statement makes clear.
- The import page takes a whole batch (multi-select or drag and drop, Jago and GoPay mixed): every file is read and
  previewed, then one button saves them, GoPay first and then Jago, oldest first (`apps/web/src/lib/statement-batch.ts`).
  Either order names the GoPay payments, but with GoPay first the Jago rows arrive with the real merchant, so household
  rules match on it; saved the other way round, rules only ever see "GoPay".
- The web app is an installable PWA (`public/manifest.webmanifest`). On Android, PDFs shared to JoyoArto are POSTed to
  `/share-target`; `public/sw.js` (its only job, no offline caching) parks them in the Cache API and opens `/import`,
  which loads them into the batch. Without the service worker the worker redirects to `/import?shared=failed`. iOS has
  no share target; the import page explains multi-select from Files.

Other banks: CSV import with a column mapping, or ask Claude to read the PDF (`import_transactions`).

### Statements by email

Settings → Import by email gives the household a private address, `import+<token>@arto.joyorogo.com` (26 random base32
characters; `IMPORT_EMAIL_DOMAIN` in wrangler.jsonc; "New address" replaces it, "Turn off" deletes it, and mail to an
unknown or old token bounces). Cloudflare Email Routing passes the mail to the Worker's `email()` handler
(`apps/server/src/email.ts` → `services/inbound.ts`):

- **Sender check.** Only mail whose envelope sender is a member's email is read (compared without `+tags`, and without
  dots for Gmail, so Gmail's auto-forward `you+caf_=…@gmail.com` matches). When Cloudflare's authentication results say
  the sender's domain failed SPF, DKIM and DMARC, it is refused too. Refused mail is logged and not answered.
- **Import.** Each PDF attachment (at most 10) is read on the server and imported with `commit=true` (source `email` in
  the import log; dedupe makes a second copy harmless). Password-protected PDFs, non-statements and Jago statements whose
  balances do not add up are reported, not imported.
- **Reply** with `message.reply()` to the sender: per file the kind, period, new rows, duplicates, whether balances were
  checked and how many are uncategorized; also when nothing could be read. Auto-submitted mail is never answered.
- **Log.** `inbound_email` keeps the last 100 emails per household (sender, subject, status, per-file results; never the
  body or attachments), shown under Settings. Gmail's forwarding confirmation (from `forwarding-noreply@google.com`) is
  kept with its code, so you can finish setting up auto-forwarding.

The risk: anyone who knows the address *and* can send mail that looks like it comes from a member could add
transactions. Mitigations: the address is a 130-bit secret that can be replaced, envelope senders must be members, a
domain that fails Cloudflare's SPF/DKIM/DMARC checks is refused, the summary goes to the member's real address (so
spoofed imports are noticed), imports only add rows (never edit or delete) and every batch can be undone.

## Quick add and reconciliation

Quick captures (the web box, Claude's `quick_add`, an iOS Shortcut, later a notification reader) are saved as
**pending** transactions: they count in reports and the dashboard right away, and the monthly statement confirms them.

- `POST /api/transactions/quick` (oRPC `transactions.quickAdd`) takes `amount` (signed minor units) or `amountText`
  ("25rb", "Rp 25.000", "1,5jt", "+500k"; money out unless it starts with "+" or `direction` is `in`), a
  `description` and/or `merchant`, optional `accountId` (default: the household's most used account), `category`,
  `note`, `occurredAt` (day or ISO instant; the row's date is that day in WIB), `capturedVia` and `clientRef`. A
  `clientRef` is unique per household: sending it again returns the first row, so a phone can retry safely.
  `rawText` (a notification body) is read for the amount, direction and merchant when those are not sent, and is never
  stored or logged.
- Every statement import (CSV, `import_transactions`, Jago/GoPay) first looks for a pending row in the same account
  with exactly the same amount, dated at most a day from the statement row. Several candidates: the most similar
  merchant/description wins, then the closest date, then the earliest capture. The statement row replaces the pending
  one, keeping the statement's date, amount, description and balance, and taking over the pending row's category
  (when the statement's would be empty or only an import suggestion), merchant (when the statement's is generic or
  only cleaned up from the description), note, tags and `clientRef`. Results report `reconciled`, and
  `unmatchedPending` for pending rows inside the statement's period that nothing matched (they stay; fix or delete
  them). Undoing such an import turns those rows back into pending ones.
- Pending rows can be edited (amount, date, description too) and deleted; the dashboard flags those older than 45 days.

### iOS Shortcuts

A Shortcut can post a bank app's notification (iOS 27 Shortcuts automations can run on an app's notification) or a
typed amount. Create a token in Settings (`finance:write`), then in the Shortcut use **Get Contents of URL**:

```sh
curl -X POST https://app.arto.joyorogo.com/api/transactions/quick \
  -H "Authorization: Bearer brk_..." -H "Content-Type: application/json" \
  -d '{"rawText": "<notification body>", "accountId": "<the bank account id>", "capturedVia": "shortcut", "clientRef": "<notification id or date+body hash>"}'
```

Per bank, prefer extracting the amount with a **Match Text** action and sending `amountText` plus `description` (the
merchant part of the body); `rawText` is the fallback when the format is unknown. Account ids come from
`GET /api/accounts`. A response with `"created": false` means that `clientRef` was already saved.

## Mobile app (`apps/mobile`)

Expo SDK 58 development build (custom native code), TypeScript, `react-native-unistyles` with the JoyoArto tokens
(`theme.ts`, converted from `packages/ui/src/styles/globals.css`, light and dark), expo-router with a floating tab bar
like the web's (Home · Transactions · + Add · Joyo AI · More), TanStack Query over a typed oRPC client (the server's
router types, `src/lib/orpc.ts`). Structure and conventions for new screens: `apps/mobile/AGENTS.md`.

- **Sign in** with Google (native account sheet, Android and iPhone) or Sign in with Apple (iPhone): the ID token goes to
  better-auth (`/api/auth/sign-in/social`), whose bearer plugin returns a session token the app keeps in
  `expo-secure-store` and sends as `Authorization: Bearer`. A personal access token (`brk_…`, web Settings → API tokens)
  and **Coba demo / Reviewer** (a demo code, see "Demo account" below) still work. Client ids and the one-time Google
  Cloud / Apple steps: `docs/mobile-auth.md`.
- **Home**: the web dashboard for any month (`reports.dashboard`): money in/out, net and savings rate with deltas,
  spending by category (donut and legend, tap to filter), cash flow (6 months), spending pace, needs attention (pending
  quick adds, uncategorized, stale accounts), budgets, top merchants, balances. Cheap reads are cached on the device, so
  it opens offline.
- **Transactions**: search, filters (account, category or uncategorized, status, date range), infinite list by day,
  per-row categorize with a searchable picker and "remember for this merchant" (a rule that also fills in its past
  uncategorized rows), detail and edit (merchant, note; amount/date/description/account and delete for pending rows).
- **Add sheet** (centre button): say it (up to 60 s; expo-audio, sent to `/api/capture/transcribe`, Workers AI
  Whisper, not stored; the only permission the app asks for, the first time the mic is tapped) or type it ("kopi 25rb
  gopay"), `capture.parse` drafts it, review, Save = quick add (pending).
- **Joyo AI** tab: the web's chat, streamed (the app reads `POST /api/joyo/chat` as server-sent events with
  `expo/fetch`; oRPC's own stream decoder needs web streams Hermes lacks), markdown answers, "reading …" tool chips,
  proposals with Confirm/Dismiss, history, starter prompts, the off and daily-cap states, and an optional own API key in
  the phone's secure storage (removed at sign-out). On iOS nothing points to buying more.
- **Receipts and Reimburse**: Foto struk in the add sheet (camera permission asked the first time; the gallery uses
  the system photo picker), photos and the Diganti kantor switch on the transaction screen, More → Reimburse (claim
  PDF/CSV saved and shared with expo-sharing), Settings → Reimbursement.
- **Plan & simulate** (More → Plan): the web's planner with the same templates, editors (spending cuts too), verdicts,
  projection chart, side by side, a read-only Where to save summary and household saved scenarios (a scenario saved on
  the phone opens with the same blocks on the web). The unsaved draft stays on the phone, per household.
- **More**: profile with the Google photo, Import, Accounts, Plan, Household, Settings, appearance, sign out.
- **Notification capture (Android)**: `modules/notification-capture` is a local Expo module (Kotlin) with a
  `NotificationListenerService`. Capture is off by default. When it is on, the service drops every notification whose
  package is not allow-listed (Bank Jago `com.jago.digitalBanking`, Gojek `com.gojek.app`, GoPay `com.gojek.gopay`,
  editable in the app) before reading its content, and keeps title/text of the others in a small on-device inbox.
  A headless JS task (or the open app) parses them (`src/capture/parsers`, one file per source, samples and tests in
  `samples.ts` / `parsers.test.ts`), queues them (`src/capture/queue.ts`, persisted in the app's documents directory)
  and sends **only the parsed fields** (amount text, direction, merchant, a short description, time) to the quick-add
  endpoint with `capturedVia: notification` and `clientRef` built from the notification key, its `Notification.when` and a hash of the text, so retries are
  idempotent. The notification text never leaves the phone. Low-confidence parses wait under **Captured** for a check;
  failed sends retry with backoff (on reconnect, on app foreground, each minute while open, and on the next capture).
  Account/category can be fixed before sending, or after (PATCH on the pending row).
- **Share PDF → JoyoArto**: an `application/pdf` share target on Android (SEND and SEND_MULTIPLE, `expo-share-intent`;
  its iOS share extension is off for now, `docs/ios-release.md`) and a document picker. Each file goes to
  `POST /api/imports/statement-file`
  (multipart `file`, `commit=false` preview, then `commit=true`), with the same result as `/api/imports/statement`.
  Settings → Development → "Mock statement uploads" answers locally until that endpoint is deployed.

To add a source app: write `src/capture/parsers/<source>.ts` (its `KNOWN` success patterns and ignore rules on top of
`parseWith`), add sample strings with their expected result to `samples.ts`, and register it in `SOURCES`.

### Build and install (Android)

APKs are built by GitHub Actions (`.github/workflows/android.yml`, runs on pushes touching `apps/mobile/**` and by
hand), not on the laptop: a full native build needs more memory than it has to spare.

```sh
gh workflow run android.yml -R dzulfikar08/joyoarto --ref <branch>      # -f variant=debug for a dev-client build
gh run download <run-id> -R dzulfikar08/joyoarto -n joyoarto-android-apk
adb install -r joyoarto-release.apk
```

The default `release` variant bundles the JS and runs on its own. It is signed with the release key when the
repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
`ANDROID_KEY_PASSWORD` exist, otherwise with the throwaway debug key (fine for sideloading). The `debug` variant is the
Expo dev client: run `bun run dev` in `apps/mobile` and `adb reverse tcp:8081 tcp:8081`. The build itself is
`apps/mobile/scripts/build-android-ci.sh` (`expo prebuild`, Gradle, and a check that the merged manifest has the
capture service and the PDF share filter). Local checks: `bun run check-types` and `bun run test` in `apps/mobile`.

**Granting notification access:** in the app, Captured → Notification capture → "Open notification access" and switch
JoyoArto on. Android 13+ blocks this for apps installed outside the Play Store ("Restricted setting"): open App info,
⋮ → "Allow restricted settings", then try again. Then pick the apps, the account each one's payments go to, and turn
"Capture payments" on.

**Testing capture** (debug builds): the capture screen has a test sender that feeds sample notifications through the
same path as real ones. With "Accept adb test notifications" on, `adb shell cmd notification post -S bigtext -t
'Pembayaran berhasil' test1 'Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.'` is read too. Against a server
without a phone: `bun scripts/e2e-capture.ts http://localhost:3500 brk_…` runs every sample through the parser and
queue and checks what the server saved (use a throwaway local household). From the emulator, the local server is
`http://10.0.2.2:3500` (sign-in screen → Server…).

### Demo account (store reviewers, screenshots)

A separate demo user (`demo-reviewer`) and household (`demo-household`) with made-up data: Jago pockets, a GoPay wallet,
about three months of categorized spending at public brands, pending quick adds, budgets, rules and a saved plan
scenario (`packages/api/src/services/demo.ts`, ids and restrictions in `lib/demo.ts`).

- **Off unless the Worker secret `DEMO_LOGIN_CODE` is set.** The code is typed on the Android sign-in screen (**Coba
  demo / Reviewer**: `POST /api/demo/token` → a 7-day `brk_` token) or on the web login page (**Demo account**:
  `POST /api/auth/sign-in/demo` → a session). Both compare in constant time and are rate limited per IP.
- **Resets:** every demo sign-in rebuilds the household (same WIB day = same data), and a daily cron (03:00 WIB) does
  too. Operators can call `POST /api/admin/demo/reset`. The demo user's sessions and tokens survive a reset.
- **Restricted:** no invites, joining/leaving/deleting households, account deletion, tokens longer than a day,
  email-in or OAuth AI connections (FORBIDDEN with `data.demo`). Always Pro. Everything else, writes included, works.
- Reviewer instructions for the store consoles: docs/HANDOFF.md.
### Build and upload (iOS)

`.github/workflows/release-ios.yml` (manual, environment `release`) builds the App Store IPA on a GitHub macOS runner and
can upload it to TestFlight, the same pipeline as JoyoRogo: `gh workflow run release-ios.yml -R dzulfikar08/joyoarto -f
upload_testflight=true`. Secrets, signing, the privacy manifest and the App Store notes: `docs/ios-release.md`.

### Over-the-air JS updates

JS and asset fixes reach installed apps through EAS Update (`expo-updates`, EAS project `@dzulfikar08/joyoarto`)
without a store review: Actions → **OTA update** (`.github/workflows/ota.yml`, environment `release`), or
`apps/mobile/scripts/ota.sh` on the Linux box. Play and TestFlight builds listen to `production`, the sideload APK to `preview`. What
may ship over the air, rollback and the owner's one-time setup (`EXPO_TOKEN`): `docs/ota.md`.

## Public pages and waitlist

- `/` shows the landing page to visitors (Bahasa Indonesia first, English via the toggle or `?lang=en`); signed-in users
  get the dashboard. Its hero links to `/login` ("Daftar gratis"; sign-up is open when `OPEN_SIGNUP` is set), the demo,
  and the two install sections: `#android` (and the More page's "Pasang di Android") gives the steps to join the Android
  closed test, `#iphone` the TestFlight steps. Links live in `apps/web/src/lib/app-links.ts`; while `IOS_TESTFLIGHT_URL`
  is empty the iPhone section says the public link is coming and points to the web app. `/demo` reads Jago/GoPay statement PDFs in the browser with the same parsers
  (`lib/statements/summary.ts`; `sample.ts` is a made-up statement for "try a sample") and uploads nothing.
- The public waitlist is closed: there is no join endpoint or form any more. The `waitlist_signup` table and its rows
  are kept so the owner can contact the people already on it. `GET /api/waitlist` (`waitlist.list`) and the page
  `/admin/waitlist` show them: browser sessions whose email is in `ADMIN_EMAILS` only (a deploy-time var, see Deploy).
  Deleting an account also deletes the waitlist row with the same email.
- `WAITLIST_LIMITER` (the name is historical) now only rate-limits demo-code sign-in attempts per IP.

## Joyo AI and the add sheet

**Navigation.** Phones get a floating pill tab bar (`apps/web/src/components/bottom-nav.tsx`, ported from JoyoRogo): Home,
Transactions, a centre **Add** button, Joyo AI, More (`/more`: Plan, Import, Accounts, Settings, privacy, sign out). Tablets
and desktops get a top bar with every page, Joyo AI and an Add button that opens the same sheet.

**Add sheet** (`components/add-sheet.tsx`). Say it (MediaRecorder, at most 60 s) or type it ("kopi 25rb gopay"), review an
editable draft, then Save, which is `transactions.quickAdd` (pending, as before). Nothing is saved before Save.

- `POST /api/capture/transcribe` (oRPC `capture.transcribe`, multipart `audio`): Workers AI Whisper
  (`@cf/openai/whisper-large-v3-turbo`, as JoyoRogo's "Ceritakan"). Neither the audio nor the transcript is stored. With
  no AI binding and `DEV_LOGIN` on, it answers a fixed transcript so the flow works locally.
- `POST /api/capture/parse` (`capture.parse`): text to a draft (amount, direction, merchant, description, category,
  account, date). Claude with a strict JSON schema (`output_config.format`, accounts and categories as enums), then
  `lib/capture-parse.ts` fills what the model left out; the rules parser does it all when there is no key, the cap is
  reached or the model fails. It reads Indonesian number words ("dua puluh lima ribu", "16 juta", "satu setengah juta").

**Joyo AI** (`/joyo`, `routers/joyo.ts`, `lib/joyo-ai/`), ported from JoyoRogo's Joyo AI and adapted to finance:

- **Tools** are the shared catalog in `packages/api/src/tools.ts` (the MCP server uses the same list). Entries with
  `chat: "read"` run through oRPC `call` under the member's own context, so the chat sees exactly what the REST API would:
  the active household, the session's scopes. `chat: "propose"` tools (quick_add, categorize, update_transaction,
  create_rule, set_budget, save_scenario) never run in the answer loop: they become a card with Confirm and Dismiss, and
  `joyo.proposal` runs the stored arguments (never the client's) when the member confirms. A quick add's `clientRef` is
  the proposal id, so a double confirm adds one row.
- **Engines.** Hosted: Claude through `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY` (default `claude-opus-5-5`,
  `JOYO_AI_MODEL`, effort `JOYO_AI_EFFORT`, server-side refusal fallback on), optionally through Cloudflare AI Gateway
  (`ANTHROPIC_BASE_URL`); without a key, the Workers AI binding (`JOYO_WORKERS_AI_MODEL`) through JoyoRogo's OpenAI-format
  shim; with neither, the hosted chat is off. **Own key** (BYOK, as in JoyoRogo's phone app): Anthropic, OpenRouter or
  OpenAI with fixed base URLs. The key stays in the browser's localStorage and rides along with each question; the server
  uses it for that call and never stores or logs it.
- **Limits and usage.** `ai_usage` keeps one row per AI call (kind, engine, model, outcome, tokens, latency; never text).
  A slot is reserved before the model runs in one conditional INSERT, so concurrent questions cannot pass the cap:
  `JOYO_AI_DAILY_CAP` hosted questions per member per WIB day (default 30, `0` = hosted off), 300 with an own key, and
  `JOYO_CAPTURE_DAILY_CAP` voice notes plus AI parses (default 60).
- **Conversations** (`joyo_conversation`, `joyo_message`) are private to the member and kept per household (the 50
  newest). The server reads the history itself; the client sends only the new message. Answers stream as events
  (`start`, `round`, `text`, `toolStart`, `toolDone`, `proposal`, `done`); the web page renders markdown with JoyoRogo's
  parser (`lib/joyo-ai/markdown/parse.ts`).

## Receipt photos and reimbursement (Diganti kantor)

**Receipt photos.** The add sheet (web and phone) has **Foto struk**: the camera (`capture=environment` on the web,
expo-image-picker on the phone) or the gallery. The client shrinks the photo to about 1600 px on the long side (JPEG
0.7) and sends it to `POST /api/capture/receipt` (oRPC `capture.receipt`, multipart `image`). The server stores it
first (`attachment` row, R2 key `h/<householdId>/r/<id>` in the `RECEIPTS` bucket, `joyoarto-receipts`), then reads it
into the same draft as voice and text: Claude vision (`JOYO_PARSE_MODEL`) with a strict JSON schema when
`ANTHROPIC_API_KEY` is set, else the Workers AI vision model `JOYO_VISION_WORKERS_AI_MODEL` (Gemma 4 reads images).
`lib/receipt.ts` checks the answer (positive total, a real date not in the future nor over a year back, the household's
own category and account, the printed payment method matched to an account, line items into the note). The member
reviews the draft and Save is `transactions.quickAdd` with `attachmentIds`. When nothing can be read (no AI, today's
cap, a failure) the photo is still kept and the draft comes back empty.

- Photos are served only by `GET /api/attachments/{id}` to members of the household (session or bearer token): no
  public URLs, and never to Claude (tools see attachment ids only). `POST /api/attachments` adds or replaces
  (`replace=true`) a photo on an existing transaction (Transactions → Details on the web, the transaction screen on the
  phone); `DELETE /api/attachments/{id}` removes one.
- Deleting a transaction or undoing its import deletes its files; a statement row that confirms a quick add takes over
  its photos (and reimbursement); deleting a household (or the account that was its only member) deletes every object
  under the household's prefix. The daily cron removes uploads never attached after a day.
- Limits: receipts have their own daily slot in `ai_usage` (kind `receipt`): Free 3 a day, Pro up to
  `JOYO_CAPTURE_DAILY_CAP`.

**Reimbursable expenses.** An expense paid personally for work can be marked **Reimburse / Diganti kantor** (add sheet,
transaction details, `POST /api/reimburse/mark`, MCP `mark_reimbursable`) for a **reimbursement profile**: the company
that pays it back, with the claimant's name, employee ID, department and approver printed on reports (Settings →
Reimbursement; several companies allowed, the last used is the default).

- *Accounting.* The expense stays on the account that paid it (balances and statement reconciliation are untouched), but
  while it is `draft`, `submitted` or `paid` it is a **transfer into the company's receivable**: `kindExpr` in
  `services/reports.ts` treats it as `transfer`, so the dashboard, spending summaries, cash flow, budgets and the Plan
  baseline leave it out. Each profile has an account of type `receivable` ("Reimburse PT …") whose balance is what the
  company still owes (draft + submitted items). The company's money-in row can be marked as the claim's `payment`; it is
  a transfer out of the receivable, so it is not income. A `rejected` item is household spending again.
- *Claims.* The Reimburse page (web `/reimburse`, phone More → Reimburse; the dashboard links to it while items are
  open) lists draft items per company; "Buat laporan" (`POST /api/reimburse/claims`) numbers a claim (`RB-YYYY-NNNN`),
  freezes what it prints (`reimbursement_claim.snapshot`) and marks the items `submitted`. `GET
  /api/reimburse/claims/{id}/pdf` (pdf-lib: header, item table, subtotals per category, total in numbers and in words
  via `terbilang`, signature blocks for claimant, approver and finance, then one appendix page per receipt photo; items
  without one are marked "tanpa bukti") and `/csv` can be downloaded again at any time. Then: paid (optionally with the
  payment row and the items the company refused), rejected, reopened, or withdrawn (items back to draft). JoyoArto never
  sends anything to the company. Free makes 1 claim report a month; Pro unlimited.

## JoyoArto Pro (billing)

JoyoArto is AGPL and free to self-host. On the hosted service the paid plan is **Joyo Pro**: one subscription per
**account**, shared by JoyoRogo, JoyoFit and JoyoArto. **JoyoRogo's server is the only billing authority** (as it already
is for JoyoFit): Joyo Pro is bought, renewed and managed in JoyoRogo with the same Google account. JoyoArto sells
nothing, holds no payment credentials and receives no payment webhooks.

- **Free vs Pro** live in one module, `packages/api/src/lib/billing/plans.ts`: Free has manual entries, quick add and CSV
  import, 2 statement imports a month per user (WIB, counted in `usage_counter` when an import saves rows; previews are
  refused once they are used), 5 hosted Joyo AI questions a day and households of 2 (pending invites count). Pro:
  unlimited statement imports (bulk, email-in, share-to-app), the server's `JOYO_AI_DAILY_CAP`, 6 members, saved Plan
  scenarios and the Claude connector (MCP). The REST API, tokens and the phone app work on Free.
- **Per account, not per household.** Every limit follows the **acting user's** plan; a household has no plan. Member
  seats follow the **inviter's** plan (an invite without a known inviter gets the Free limit). Email-in follows the
  sender's plan.
- **Enforcement** is server-side (`services/billing.ts`): a limit throws `FORBIDDEN` with `data: { upgrade: true,
  feature }`; the web client's interceptor (`apps/web/src/lib/orpc.ts`) opens the upgrade sheet. A Free user's MCP
  connector stays connected but every tool answers that it needs Pro. Downgrades delete nothing.
- **Plan resolution** (`lib/billing/entitlement.ts`, `services/billing.ts` `userPlan`): billing off → everyone Pro; email
  on `PRO_EMAILS`/`ADMIN_EMAILS` → Pro; accounts created before `PRO_GRANDFATHER_CREATED_BEFORE` → Pro until
  `PRO_GRANDFATHER_UNTIL`; new accounts → `PRO_TRIAL_DAYS` of Pro; else **Joyo Pro from JoyoRogo**; else Free. Limit
  checks skip the JoyoRogo call while a local rule already grants Pro; Settings → Billing always asks.
- **Asking JoyoRogo** (`lib/billing/joyo-pro.ts`): `POST {JOYOROGO_API_URL}/api/internal/joyo-pro/status` with header
  `x-joyo-internal-key: JOYO_INTERNAL_KEY` and body `{ googleSub?, email }` → `{ pro, until, plan, source }`. Both apps sign
  in with the same Google OAuth client, so `googleSub` is better-auth's `account.accountId` for provider `google`; the
  email is sent only when verified. Answers are cached per user in `joyo_pro_status` (Pro 10 minutes, not-Pro 2). If
  JoyoRogo is unreachable or refuses the key, a user it confirmed stays Pro for at most 24 h past the last end it
  confirmed (a lifetime grant stays); a user it never confirmed stays Free; a failed call is not retried for that user
  for a minute.
- **Billing is on only with `PAYWALL=1` and `JOYO_INTERNAL_KEY` set.** No key (a self-host) = billing off, everyone Pro,
  no pricing page, nothing sent to JoyoRogo.
- **Prices** are JoyoRogo's own, read at runtime from its public `GET /api/config` (cached 10 minutes per isolate), so
  they never drift: the founder ladder step (today `10:15000/149000,60:29000/199000,:49000/349000`), the
  "X slots left at this price, then Rp Y" promo and the USD price. If JoyoRogo does not answer, the page shows no
  numbers and points to JoyoRogo.
- **Buying:** "Upgrade" links to `JOYO_PRO_URL` (JoyoRogo's `/pro`) with `?from=joyoarto`. Pro shows up in JoyoArto at
  the next check (within ~2 minutes for a user who was Free).
- Web: `/pricing` (public), the landing page's Pricing section, Settings → Billing (plan and until from JoyoRogo, usage,
  "Manage in JoyoRogo").
- **Phone app purchases (later):** Google Play and App Store purchases in the JoyoArto app will go through JoyoRogo's
  `/api/billing/google` and `/api/billing/apple`, like JoyoFit (docs/HANDOFF.md).

## Data & privacy (UU PDP)

Settings → Data & privacy, all browser-session only (`packages/api/src/services/account.ts`):

- `GET /api/account/export` (oRPC `account.export`): JSON of the user (profile, sign-in methods, sessions without
  tokens), memberships, and the active household's finance data; tokens and connected apps as metadata only. Big
  tables are read in keyset pages. `EXPORT_COVERAGE` lists every schema table and where it goes; a test fails when a
  new table is not listed. `GET /api/account/export/transactions.csv` is the CSV.
- `GET /api/account/connections`, `DELETE /api/account/connections/{clientId}`: AI apps (OAuth consents); disconnecting
  deletes the consent (/mcp refuses JWTs without one) and revokes refresh/access tokens.
- `POST /api/household/delete` (owner, types the name) deletes the household and everything in it.
  `POST /api/account/delete` (types the email) deletes households where the user is the only member, leaves the
  others, and is refused while they are the only owner of a household with other members.
- Joyo AI conversations and `ai_usage` rows are in the export (`joyoConversations`, `aiUsage`) and go with the account or
  household.
- MCP audit rows are kept 90 days: about one MCP call in 50 prunes older rows (no cron trigger yet).
- `/privasi` and `/syarat` are the privacy policy and terms; the operator and contact live in `apps/web/src/lib/brand.ts`.
  Keep them true when changing what is stored or shared.

## Local development

```sh
bun install
cp apps/server/.dev.vars.example apps/server/.dev.vars   # set BETTER_AUTH_SECRET; DEV_LOGIN=1 enables "Dev login"
bun run db:migrate:local
bun run dev:server   # http://localhost:3000  (API docs: /api/docs)
bun run dev:web      # http://localhost:3001
bun run test         # unit tests (packages/api)
```

After changing `packages/db/src/schema`, run `bun run db:generate` and apply the migration.

## Deploy (Cloudflare)

One worker (`baroka`, config in `apps/server/wrangler.jsonc`) serves the web app's static build and the API on the same
origin, so auth cookies stay first-party. Live at https://app.arto.joyorogo.com (landing page: https://arto.joyorogo.com) (D1 database `baroka`). The public origin for canonical URLs, share
tags and the sitemap is `SITE_URL` in `apps/web/src/lib/brand.ts`; search and link previews are described in
[docs/SEO.md](docs/SEO.md).

```sh
bun run db:migrate:remote   # after a schema change
bun run deploy              # builds apps/web, deploys the worker
```

Receipt photos need the R2 bucket `joyoarto-receipts` (binding `RECEIPTS`); `deploy.yml` creates it when missing, so the
deploy token needs Workers R2 Storage:Edit. Secrets (`wrangler secret put`, in apps/server): `BETTER_AUTH_SECRET` (set), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`ANTHROPIC_API_KEY` (optional), and for Joyo Pro `JOYO_INTERNAL_KEY` (the same value as on JoyoRogo's server; unset = billing
off). `DEMO_LOGIN_CODE` (optional) turns on the store reviewers' demo account. No payment secrets: JoyoRogo sells Joyo Pro.
`ALLOWED_EMAILS` and `ADMIN_EMAILS` (comma-separated) are not in wrangler.jsonc: `deploy.yml` passes them with
`wrangler deploy --var` from the `production` environment's variables (GitHub → Settings → Environments), and refuses
to deploy without them. Deploying by hand: `bunx wrangler deploy --var ALLOWED_EMAILS:you@example.com --var ADMIN_EMAILS:you@example.com`.
`OPEN_SIGNUP` (same place, optional): `1` or `true` lets anyone with a Google or Apple account sign up; unset or anything
else keeps sign-up to `ALLOWED_EMAILS` and pending invites.
Google OAuth redirect URI: `https://app.arto.joyorogo.com/api/auth/callback/google`. Moving to a custom
domain means updating the four URL vars in wrangler.jsonc, `SITE_URL`/`APP_ORIGIN` in brand.ts (and the hosts in `apps/web/index.html`, `public/_headers`, `apps/server/src/seo.ts`), the Google redirect URI, and reconnecting Claude.

## Connecting Claude

- **claude.ai / Desktop:** add a custom connector with URL `<api origin>/mcp`; you sign in and approve on `/connect`.
- **Claude Code:** create a token in Settings, then
  `claude mcp add --transport http joyoarto <api origin>/mcp --header "Authorization: Bearer brk_..."`.

PDF statements from any bank go through Claude: drop the PDF in a chat and ask it to import it. The tool previews
first, checks the parsed amounts against the statement's running balance, then commits.

## License

AGPL-3.0-or-later (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). The JoyoArto name and logo are trademarks and are
not covered by the licence. Security reports: [SECURITY.md](SECURITY.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).
