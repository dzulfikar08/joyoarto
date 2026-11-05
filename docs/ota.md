# Over-the-air JS updates (EAS Update)

Written 2026-11-05, copied from JoyoRogo's `docs/ota.md`. JS and asset fixes (layout, copy, parsing, calculations) reach
installed phones in minutes instead of waiting for a store build and review. The native binaries are still built by our
own workflows (`Release Android`, `Release iOS`, `Android`). Only the update hosting is EAS: **EAS Update works with
self-built binaries**, no EAS Build is involved and there is no `eas.json`.

| | |
| --- | --- |
| Library | `expo-updates` ~58.0.21 (`apps/mobile`) |
| EAS project | `@dzulfikar08/joyoarto`, id `df6f8a8c-9a66-4dd9-a5b1-4dbd3fd3f951` (`app.json`: `extra.eas.projectId`, `updates.url`, `owner`) |
| runtimeVersion | `{ "policy": "fingerprint" }` |
| Channels | `production` (Play and TestFlight builds), `preview` (the sideload APK of `android.yml`). Each channel points at the branch of the same name; both were created on 2026-11-05 |
| Publish | Actions → **OTA update** (`.github/workflows/ota.yml`), which runs `apps/mobile/scripts/ota.sh` |
| Signing | none: EAS Update code signing needs a paid EAS plan (see Signing) |

## First release: one normal build per platform

**Binaries built before this change have no expo-updates and never receive an OTA update.** After this lands on `main`,
run **Release Android** (Play closed testing) and **Release iOS** (TestFlight) once, as usual. Those are the first
binaries that check for updates. Everything below applies only to them and to later builds.

## One-time setup (owner)

1. **EXPO_TOKEN.** The OTA workflow publishes as the Expo account `dzulfikar08`. On expo.dev: Account settings → Access
   tokens → Create token (name it e.g. `github-actions-ota-joyoarto`; a personal token, not a robot one, unless you also
   give the robot access to the project). Then put it in the `release` environment:

   ```sh
   gh secret set EXPO_TOKEN --env release -R dzulfikar08/joyoarto     # paste the token when asked
   ```

   JoyoRogo's token is a secret of the JoyoRogo repo and cannot be copied; a new token (or the same token value, if you
   still have it) has to be set here. Revoke it on the same expo.dev page if it leaks.
2. **Owner approval.** On 2026-11-05 the `release` environment only limits deployments to `main`; it has no required
   reviewer, so anyone who can run workflows on `main` could publish (or release). To match JoyoRogo: Settings →
   Environments → `release` → Required reviewers → add yourself.
3. **Keep 2FA on the Expo account.** Without code signing, trust rests on TLS to `u.expo.dev`, the Expo account and the
   `EXPO_TOKEN` secret.

Done already: the EAS project (`bunx eas-cli init`) and the `production` and `preview` channels (`eas channel:create`).

## What may ship over the air (store policy)

Only **JS and asset bug fixes and improvements** that leave the app doing what it was submitted to do.

- Apple: interpreted code may be downloaded as long as it does not change the app's primary purpose or add features
  inconsistent with what was reviewed (guidelines 3.3.1 and 4.7, and the Developer Program License Agreement). The
  code runs in React Native's own JS engine, not a downloaded native binary.
- Google Play: the Device and Network Abuse policy forbids an app from modifying or replacing itself by any method
  other than Play's update mechanism, except code that runs in an interpreter or VM and reaches Android APIs only
  indirectly. Hermes JS is that case. Native code never ships over the air.

Fine over the air: layout, keyboard handling, copy, a parser fix for a bank's notification or statement wording that
already is supported, calculations, bug fixes, new screens built from what the app already does, image assets.

**Not** over the air, ship a reviewed build:

- a new primary purpose, or a feature the store listing and review notes do not describe;
- anything about payments: Joyo Pro purchase paths, prices or texts, the iOS store-safe rules
  (`src/lib/billing.ts`, `src/lib/platform.ts` `storeSafe`, `errorMessage(e, { storeSafe })`). Store billing rules apply
  to the build under review, not to a later JS swap;
- new permissions or a new use of an existing one; new data collection or sharing (Play Data safety, App Store privacy
  labels). For notification capture that includes **reading notifications from a new app or sending more of a
  notification's content to the server**: the notification listener is a sensitive Play permission and its declared use
  is the allow-listed payment apps;
- new SDKs or trackers; anything that bypasses OS signing or sandboxing;
- native code, config plugins, `app.json` / `app.config.ts` native settings, native dependencies (they cannot ship over
  the air anyway, see below).

Wording above is our reading of the policies; read the current Apple and Google text before a gray-area change.

## How a build and an update find each other: runtimeVersion

Policy `fingerprint`: every binary embeds a hash of its native side, and the update server only offers an update
published for **that** hash. An update can therefore never land on a binary with incompatible native code. A mismatch
is silent and safe: the app keeps running what it has.

In the hash (`bunx expo-updates runtimeversion:resolve`, `fingerprintSources` lists everything):

- the whole resolved Expo config: `app.json` plus `app.config.ts` output, **including `version`, `extra`, name,
  scheme, permissions, the plugin list and `updates`**, so also the channel header (`JOYOARTO_UPDATE_CHANNEL`) and the
  Google client ids (`JOYOARTO_GOOGLE_IOS_CLIENT_ID`, `JOYOARTO_GOOGLE_WEB_CLIENT_ID`);
- local config plugins (`plugins/*.js`), local native modules (`modules/notification-capture`), icon and splash images;
- every autolinked native package (a native dependency bump or add);
- `scripts` in `apps/mobile/package.json`, and `.gitignore`.

Not in the hash: JS and TS source, JS-only dependencies, the generated `android/` and `ios/` folders, `versionCode` and
build numbers set at build time, the `VARIANT` of `build-android-ci.sh`.

Consequences:

- Production and preview builds have different runtimeVersions (the channel is in the config). `ota.sh` resolves and
  publishes with `JOYOARTO_UPDATE_CHANNEL` set to the channel; never run a bare `eas update` by hand.
- Bumping `version` in `app.json` or touching anything native creates a **new runtimeVersion**. Updates published from
  that commit on only reach binaries built from that state. Commits that only change JS leave it alone.
- Every `Release Android`, `Release iOS` and `Android` run prints its runtimeVersion in the job summary (step "OTA
  runtimeVersion"). `apps/mobile/scripts/ota.sh --runtime` prints both platforms' values for the current commit. The
  More page of a release build shows the first 8 characters it runs (`built-in · production · runtime 113a4f54`).
  They must match for an update to arrive. The OTA workflow's optional `android_runtime` / `ios_runtime` inputs (or
  `EXPECT_RUNTIME_ANDROID` / `EXPECT_RUNTIME_IOS` locally) make `ota.sh` print a warning when they do not.
- Autolinked package paths are `node_modules/.bun/<pkg>@<version>+<peer-hash>/…`, and the peer hash depends on the bun
  version that installed them (JoyoRogo saw 1.4.3 and 1.4.4 resolve the same commit differently). The root
  `package.json` pins `bun@1.4.4`; publish from Actions, where the builds ran, rather than a laptop with another bun.
  Leftover packages from another branch also move the runtime: `rm -rf node_modules apps/*/node_modules
  packages/*/node_modules && bun install --frozen-lockfile` fixes that.

## Behaviour in the app

- `updates.checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`: on a cold start the app launches at once with the
  newest bundle it already has (embedded or downloaded), checks the server in the background and downloads a newer
  update, which is applied on the **next cold start**. There is no in-app banner or manual check (JoyoRogo has one,
  `use-ota-update.ts` and its Profil card, if we want it later).
- The More page footer shows which bundle runs (`built-in` or `update <id>`), the channel and the runtime prefix
  (`src/lib/ota.ts`). Absent in dev clients and on the web, where `Updates.isEnabled` is false.
- **A bad update falls back to the previous or embedded bundle.** A failed check or download changes nothing. expo-updates'
  error recovery (left on; nothing in `app.json` disables it) catches a fatal JS error during launch of a downloaded
  update, marks the update failed and relaunches with the previous one or the embedded bundle. A launch counts as good
  once the first screen has rendered.

### Notification capture (Android, headless)

`CaptureHeadlessService` starts the JS runtime without an activity when a payment notification arrives and runs the
headless task `JoyoArtoCapture` (registered in `src/capture/headless.ts`, imported from `index.js` before the router).
With expo-updates the service runs on the same React host, so it loads **the same bundle the app would** (the
embedded one or the newest downloaded update), and expo-updates' launch check and error recovery run as on a normal
start. Rules for OTA changes:

- never rename `JoyoArtoCapture` or drop the `./src/capture/headless` import from `index.js`: the native service asks
  for that name, and an update without it makes every background capture fail. `ota.sh` refuses an Android bundle that
  does not contain the name;
- the task already swallows its own errors, so a bug in `syncCaptures` cannot crash the process; a crash while the
  bundle itself loads triggers error recovery like any launch;
- a headless-only start never renders a screen, so it does not mark the update as good; that happens at the next
  normal start. Captures stay queued in the native inbox until a run succeeds.

## Publish

From GitHub (the normal way): Actions → **OTA update** → Run workflow on `main` with `message`, `channel`
(`production` or `preview`), `platform` (`all`, `android`, `ios`; preview is Android only) and optionally the installed
builds' runtimes. Or:

```sh
gh workflow run ota.yml -R dzulfikar08/joyoarto -f message="Fix the dashboard total"
gh workflow run ota.yml -R dzulfikar08/joyoarto -f message="Try it" -f channel=preview
```

The job runs in the `release` environment with its `EXPO_TOKEN`. The script it runs, also usable on the Linux box
with an `eas login` session:

```sh
apps/mobile/scripts/ota.sh "Fix the dashboard total"                # production, android + ios
apps/mobile/scripts/ota.sh --platform android "Copy fix"            # one platform
apps/mobile/scripts/ota.sh --channel preview "Try it on the APK"    # preview, the sideload APK
apps/mobile/scripts/ota.sh --runtime                                # runtimeVersions only, publishes nothing
```

It prints the runtimeVersion of both platforms, runs `tsc --noEmit` and `bun test ./src/`, then per platform a
production `expo export` with a clean Metro cache (it checks that the bundle contains the API URL, the app's routes
and, on Android, the capture task), then `eas update --channel <channel> --skip-bundler` with that bundle. One line
per platform ends up in the job summary:

```
android  channel=production  runtimeVersion=<hash>  group=<update group id>
```

Android and iOS are two update groups (different runtimeVersions). Nothing goes to a store.

Try a change on the sideload APK first (`channel=preview`, after an `Android` workflow build), then publish it to
`production`.

## Roll back

Instant, no store involved. Phones pick it up at their next cold start (the check), and run it at the one after.

```sh
bunx eas-cli update:rollback <group id> --non-interactive
```

The group must be the **latest** one of its branch and runtimeVersion (the id the publish printed). It republishes the
group before it, or a "roll back to embedded" directive when there is none. Other options:

```sh
bunx eas-cli update:roll-back-to-embedded --channel production --runtime-version <hash> --platform android
bunx eas-cli update:republish --group <older group id>       # re-publish a specific earlier update
bunx eas-cli update:list --branch production                 # find group ids
```

Or publish a corrected fix. Roll Android and iOS back separately (two groups). Run these on the Linux box with
`bunx eas-cli login` as `dzulfikar08`.

## When OTA is not enough

Anything that changes the runtimeVersion, or is on the "not over the air" list, needs a new binary: run **Release
Android** / **Release iOS** as usual. From that commit on, updates target the new runtime. Older binaries keep getting
updates only if you publish from a commit with their fingerprint (check out the build's commit).

## Signing

EAS Update code signing is **not enabled**, as in JoyoRogo: publishing with a key fails with "EAS Update code signing
requires a subscription to the EAS Production or Enterprise plan" on the free account `dzulfikar08` (JoyoRogo, seen on
2026-10-18). A binary that embeds a certificate rejects unsigned updates, so config and plan must change together.

To turn it on after upgrading the plan: `bunx expo-updates codesigning:generate --key-output-directory
~/.config/joyoarto/ota --certificate-output-directory code-signing --certificate-validity-duration-years 10
--certificate-common-name joyoarto`, add `updates.codeSigningCertificate` and `codeSigningMetadata` (`keyid: main`,
`alg: rsa-v1_5-sha256`) to `app.json`, commit the certificate, pass `--private-key-path` in `ota.sh`, put the private
key in an `OTA_PRIVATE_KEY` secret of the `release` environment and write it to a temp file in `ota.yml`. **Every**
binary built after that expects signed updates.

## Testing after the first OTA-enabled build

1. Install a build (the `Android` workflow APK for preview; Play closed testing or TestFlight for production). The More
   footer shows `built-in · <channel> · runtime <8 chars>`; the job summary's "OTA runtimeVersion" (or
   `apps/mobile/scripts/ota.sh --runtime`, `--channel preview` for the APK) must start with the same characters. If the
   footer line is missing on a release build, expo-updates is not embedded: check the build log before publishing.
2. Publish a visible JS change to `preview`. Cold start the APK twice: the first start downloads, the second runs it;
   the footer shows `update <id>`.
3. With the app closed (swiped away), let a real Jago or GoPay payment notification arrive and check the capture shows
   up under Captured payments: the headless task ran on the update.
4. `bunx eas-cli update:rollback <group> --non-interactive`, cold start twice: the footer is back to `built-in`.
5. Airplane mode, cold start: the app starts normally.
