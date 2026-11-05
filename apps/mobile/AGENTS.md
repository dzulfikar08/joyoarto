# JoyoArto phone app (`apps/mobile`): notes for agents

Expo SDK 58 dev build, React Native 0.88, expo-router, react-native-unistyles 3, TanStack Query, oRPC. Android first,
iOS compiles and ships through TestFlight. Read the repo's README.md "Mobile app" section, `docs/mobile-auth.md` and
`docs/ios-release.md` too.

## Rules

- **No local native builds** (no Gradle, Xcode, pods, emulators, simulators, Metro dev server on the laptops). Builds run
  on GitHub Actions: `android.yml` (APK), `release-android.yml` (Play AAB), `release-ios.yml` (TestFlight).
- Local checks only, all must pass: `bunx tsc --noEmit` and `bun test ./src/` here, `bunx oxlint apps/mobile` at the
  root (and `bun test src` in `packages/api` if you touch it).
- Public repo: no secrets, no real household data in samples or screenshots (use the demo household).
- Keep pure logic in `src/lib/*.ts` with a `*.test.ts` next to it (bun:test; no React Native imports in those files).
  React Native glue goes in a separate file (`google-native.ts` pure, `google-native-device.ts` device).

## Layout

| Path | What |
| --- | --- |
| `app/_layout.tsx` | Root stack: fonts, session gate (signed out → `/login`), query persistence, add sheet, toasts, capture sync, PDF share routing. Register every new pushed screen here with its title. |
| `app/(tabs)/` | The floating tab bar: `index` (Home), `transactions`, `add` (centre button, never a screen), `joyo`, `more`. |
| `app/transaction/[id].tsx` | Transaction detail and edit (opened from a list row, handed over through `src/lib/tx-cache.ts`). |
| `app/import.tsx`, `captured.tsx`, `capture/[id].tsx`, `capture-setup.tsx` | Statement PDFs and Android notification capture. |
| `app/import.tsx` + `components/import/` | Statement PDF batch (preview, GoPay-first save, combined result), CSV with column mapping, email-in card, import log with Undo. |
| `app/accounts.tsx`, `account/[id].tsx` + `components/accounts/` | Accounts (archived collapsed), detail, add/edit sheet, archive. |
| `app/household.tsx`, `settings.tsx`, `data-privacy.tsx` + `components/settings/` | Members, invites (share sheet), switch; billing (`src/lib/billing.ts`), Claude, API tokens, theme; export and deletion. |
| `components/session-only.tsx` | `useHasSession()` / `SessionOnlyNote`: tokens, invites, email-in, export and deletion need a Google/Apple sign-in. |
| `app/plan.tsx`, `components/plan/` | Plan & simulate: baseline, scenario editors (loans with sale terms, baby, one-offs, monthly costs, income changes, spending cuts), a read-only Where to save summary (`savings-card.tsx`, `plan.savings`), projection chart, side by side, saved scenarios. State and form mapping: `src/lib/plan-state.ts` (same block shape as the web's `view`); draft per household on the phone: `src/lib/plan-draft.ts`. |
| `app/(tabs)/joyo.tsx`, `components/joyo/` | Joyo AI chat: streamed answers (`src/lib/joyo-stream.ts`), markdown from the shared parser, tool chips, proposal cards, history, own API key (`src/lib/joyo-byok.ts`, secure store). |
| `app/reimburse.tsx`, `app/reimburse-profiles.tsx`, `components/receipts/` | Reimburse (claims, PDF/CSV share), company profiles, receipt photos (`src/lib/receipt-photo.ts` camera/gallery + resize, `src/lib/receipt.ts` pure) and the Diganti kantor switch. |
| `components/ui/` | The UI kit. Import from `@/components/ui`. |
| `components/nav/floating-tab-bar.tsx` | The tab bar (port of JoyoRogo's). |
| `components/charts/` | react-native-svg charts (donut, cash flow, pace). |
| `components/add/add-sheet.tsx` | Say it or type it → parse → review → save (quick add). Voice: `src/lib/voice.ts` (expo-audio) and `src/lib/voice-state.ts` (pure). |
| `components/transactions/` | Row, category sheet (with "remember merchant" rule), filter sheet. |
| `components/data.ts` | Shared reads (`useAccounts`, `useCategories`, picker groups, `useMe`) and `invalidateLedger()`. |
| `src/lib/` | Pure logic and bindings: API clients, session, query policy, formatting, options, filters, dashboard maths. |
| `src/capture/`, `src/imports/`, `modules/notification-capture/` | Notification capture (Android) and statement upload, unchanged. |

## Talking to the server

- **oRPC first.** `import { client, orpc } from "@/src/lib/orpc"`: typed from `packages/api/src/routers/index.ts`
  (`import type` only, nothing from the server is bundled). Reads: `useQuery(orpc.reports.dashboard.queryOptions({ input }))`;
  lists: `orpc.transactions.search.infiniteOptions(...)`; writes: `useMutation({ mutationFn: (v) => client.x.y(v) })`
  then `invalidateLedger()` (or invalidate `orpc.<router>.key()`). Output types: `Out<AppRouterClient["x"]["y"]>` from
  `src/lib/rpc.ts`.
- The REST client (`src/lib/api.ts`) stays for multipart uploads (statement PDFs, voice notes) and for the headless
  capture task.
- **Streams**: oRPC's event-iterator decoding needs `TextDecoderStream`/`TransformStream`, which Hermes lacks. For a
  streamed procedure call its REST route with `expo/fetch` and decode the server-sent events with
  `src/lib/joyo-stream.ts` (`createSseDecoder`, `createUtf8Decoder`, `streamJoyoChat` as the example). Both send `Authorization: Bearer <token>` from the session (`src/lib/auth.ts`).
- Pure runtime helpers from `@baroka/api/lib/*` may be imported when they have no server dependencies
  (`amount-text`, `money`); never import services, routers or anything touching D1.
- Errors: `errorMessage(e, { storeSafe })` from `src/lib/errors.ts` for anything shown. On iOS (`storeSafe`) never show
  the server's Joyo Pro purchase text and never link to the web app (App Review 3.1.1; `src/lib/platform.ts`).
- Cache: `src/lib/query.ts`. Fresh for a minute, refetch on app focus and reconnect, offline-first. Cheap reads in
  `PERSISTED_PROCEDURES` (`src/lib/query-policy.ts`) are saved on the device for offline starts; add a procedure there
  only if its answer is small. Everything cached is dropped at sign-in and sign-out. `UNAUTHORIZED` signs out
  (`signOut({ expired: true })`, also from the headless capture sync on a 401).
- Notification captures belong to the account that read them (`src/capture/session.ts`): signing out deletes the queue,
  the native inbox and the capture settings and turns the listener off; an expired sign-in keeps the queue paused for
  the same account and resumes it after sign-in. Android backup is off (`allowBackup: false`): nothing in the app's
  files goes to Google Drive.

## UI conventions

- Tokens only: `theme.colors.*` (background, card, muted, primary, positive, warning, destructive and their `Soft`/`Ink`),
  `theme.viz.*` for charts, `theme.spacing`, `theme.radius`, `theme.fonts`. No raw hex in screens. Light and dark both
  come from `theme.ts` (converted from `packages/ui`); the More page switches System/Light/Dark (`src/lib/appearance.ts`).
- Styles with `StyleSheet.create((theme) => …)` from `react-native-unistyles`; variants with `styles.useVariants`.
- Screens: wrap in `<Screen>` (safe area, pull-to-refresh via `refreshing`/`onRefresh`, and room for the floating tab
  bar). Lists bring their own `FlatList`/`SectionList` with `useTabContentInset()` as bottom padding.
- Kit: `Text` (variants hero/title/heading/body/label/caption, tones), `Button` (primary/secondary/outline/ghost/
  destructive, `small`, `flex`), `IconButton`, `Input`, `Field`, `FieldLabel`, `Picker` (searchable sheet, grouped; build
  items with `categoryOptions`/`accountOptions` from `src/lib/options.ts`; `none` = the clearing row), `PickerButton` +
  `PickerSheet` (compact trigger), `Select` (old flat API), `DateField`, `Segmented`, `SwitchRow`, `Pill` (tappable with
  `onPress`/`selected`), `Card` (`title`/`subtitle`/`action`), `ListSection` + `ListRow`, `Money` (`signed`: money in green
  with "+"), `Avatar`, `Sheet`, `Skeleton`/`SkeletonCard`/`SkeletonRows`, `EmptyState`, `ErrorState` (`compact` keeps
  cached data visible above it), `toast.success/error` (`src/lib/toast.ts`).
- Every screen handles loading (skeletons), error (with Try again), empty (with what to do next) and offline (cached data
  plus a compact error).
- Money: prefer the API's `display` string; else `formatMoney` / `compactMoney` (`src/lib/format.ts`, the web's notation:
  "Rp 25.000", "2,5 jt"). Amounts are signed minor units; negative = money out. Dates are `YYYY-MM-DD` statement days;
  months turn over in WIB (`currentMonthWib`, `todayWib`).
- Accessibility: labels on icon-only buttons, `accessibilityRole` on tappables, 44 dp targets, charts get an
  `accessibilityLabel` with the numbers.
- Copy is English like the web, with Indonesian where the web has it (demo login).

## Auth

`docs/mobile-auth.md`. Google (native sheet) and Apple (iOS) ID tokens → `/api/auth/sign-in/social` → session token
from `set-auth-token` → secure store. Tokens (`brk_`) and the demo code still work. `src/lib/session-store.ts` (pure,
tested) holds `{ server, token, kind, me }`.

## Screens still to build (follow-up agents)

Each replaces a placeholder or a "coming" note; the web page is the spec.

- Done: **Import**, **Accounts**, **Household / Settings / Billing / Data & privacy**, **Budgets editing**, **Plan &
  simulate**, **Joyo AI chat**, **Voice quick add** (Nov 2026), **Receipt photos and Reimburse** (Nov 2026).
- Done: **OTA updates** (expo-updates + EAS Update, Nov 2026): `docs/ota.md`. JS-only changes may ship through the
  "OTA update" workflow; anything native, permissions, billing or new data collection needs a store build. Never rename
  the `JoyoArtoCapture` headless task or drop its import from `index.js`.
