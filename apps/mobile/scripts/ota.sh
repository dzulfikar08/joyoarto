#!/usr/bin/env bash
# Publish an over-the-air JS update (EAS Update, expo-updates) for the JoyoArto phone app. Policy, rollback: docs/ota.md.
#
#   apps/mobile/scripts/ota.sh "Fix the dashboard total"                production, android + ios
#   apps/mobile/scripts/ota.sh --platform android "Copy fix"            one platform only
#   apps/mobile/scripts/ota.sh --channel preview "Try it on the APK"    preview channel, the sideload APK (android.yml)
#   apps/mobile/scripts/ota.sh --runtime                                print this commit's runtimeVersions, publish nothing
#
# Normally run from GitHub Actions ("OTA update", .github/workflows/ota.yml). Steps: typecheck + unit tests, then per
# platform a release `expo export` (bundle sanity checks), then `eas update` with that bundle. Prints the runtimeVersion
# and update group id of each platform. Nothing is uploaded to a store.
#
# JS and asset changes only. A change to native code, app.json/app.config.ts, plugins, permissions or a native
# dependency changes the fingerprint runtimeVersion: the update then targets a runtimeVersion no installed binary has,
# and nobody receives it. Ship a new binary for those (docs/ota.md "When OTA is not enough").
#
# Needs: bun, jq, and an EAS login (`bunx eas-cli login`) or EXPO_TOKEN. Updates are unsigned (EAS Update code signing
# needs a paid EAS plan; docs/ota.md "Signing").
set -euo pipefail
cd "$(dirname "$0")/.."
MOBILE=$PWD
EAS=(bunx "eas-cli@${EAS_CLI_VERSION:-25.1.1}")
# The live API (src/lib/api.ts DEFAULT_SERVER) and a string literal from app code (app/login.tsx): an export without
# either was bundled from the wrong place or without the routes.
API_URL=https://app.arto.joyorogo.com
BUNDLE_MARKER="Without finance:write the app can show balances"

usage() { sed -n '2,7p' "$0" >&2; exit 2; }

channel=production platform=all message= runtime_only=0
while [ $# -gt 0 ]; do
  case $1 in
    --channel) channel=${2:?--channel needs production or preview}; shift ;;
    --platform) platform=${2:?--platform needs android, ios or all}; shift ;;
    --runtime) runtime_only=1 ;;
    -h|--help) usage ;;
    --) shift; message=${message:+$message }$*; break ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) message=${message:+$message }$1 ;;
  esac
  shift
done
[ "$runtime_only" = 1 ] || [ -n "$message" ] || { echo "an update message is required" >&2; usage; }
case $channel in production|preview) ;; *) echo "channel must be production or preview" >&2; exit 2 ;; esac
case $platform in android|ios|all) ;; *) echo "platform must be android, ios or all" >&2; exit 2 ;; esac
# The preview channel is what the sideload APK of android.yml listens to; there is no preview iOS binary.
if [ "$channel" = preview ]; then
  [ "$platform" != ios ] || { echo "the preview channel only has an Android build (the sideload APK)" >&2; exit 2; }
  platform=android
fi
command -v jq > /dev/null || { echo "jq is required" >&2; exit 1; }

step() { printf '\n== %s ==\n' "$*"; }
fail() { echo "ota: $*" >&2; exit 1; }

# The channel is in the binary's config (app.config.ts, expo-channel-name header) and so in its fingerprint: resolve
# and publish with the value the binary was built with. The Google client id variables are read the same way the
# release workflows pass them (unset = app.json's values).
export JOYOARTO_UPDATE_CHANNEL=$channel
runtime_of() { bunx expo-updates runtimeversion:resolve --platform "$1" | tail -n 1 | jq -r .runtimeVersion; }
# Plain variables (RUNTIME_android, RUNTIME_ios), not an associative array: macOS runners still have bash 3.2.
runtime() { local v="RUNTIME_$1"; echo "${!v:-}"; }

# Both platforms' fingerprints, always: they are what a store build has to match (docs/ota.md "runtimeVersion").
step "runtimeVersion of $(git rev-parse --short HEAD 2> /dev/null || echo this checkout), channel $channel"
for p in android ios; do
  [ "$channel" = production ] || [ "$p" = android ] || continue
  printf -v "RUNTIME_$p" '%s' "$(runtime_of "$p")"
  [ -n "$(runtime "$p")" ] && [ "$(runtime "$p")" != null ] || fail "$p: runtimeVersion did not resolve"
  echo "$p  $(runtime "$p")"
done

# Warn when nothing installed can take this update: the runtimeVersion of the last store build is printed in the job
# summary of the Release Android / Release iOS runs. EXPECT_RUNTIME_ANDROID / EXPECT_RUNTIME_IOS (a prefix is enough, e.g.
# the 8 characters on the More page) compare against it; the OTA workflow passes them from its inputs.
for p in android ios; do
  if [ "$p" = android ]; then want=${EXPECT_RUNTIME_ANDROID:-}; else want=${EXPECT_RUNTIME_IOS:-}; fi
  have=$(runtime "$p")
  [ -n "$want" ] && [ -n "$have" ] || continue
  case $platform in all|"$p") ;; *) continue ;; esac
  if [[ $have != "$want"* ]]; then
    echo "::warning::$p runtimeVersion $have differs from the store build's $want: no installed $p binary will receive this update (docs/ota.md)"
    echo "WARNING: $p runtimeVersion $have differs from the store build's $want; no installed binary will receive it" >&2
  fi
done

[ "$runtime_only" = 0 ] || exit 0

step "1. checks"
bunx tsc --noEmit
bun test ./src/

# A store build bundles with NODE_ENV=production (scripts/build-android-ci.sh through Gradle, scripts/ios/build-ios.sh).
export NODE_ENV=production

publish() {
  local p=$1 out=$MOBILE/dist/ota-$1 json bundle
  json=$(mktemp)

  step "2. $p: expo export"
  rm -rf "$out"
  # Fresh Metro cache: JoyoRogo once shipped a bundle built from a stale transform cache.
  bunx expo export --clear --platform "$p" --output-dir "$out" > /dev/null || fail "$p: expo export failed"
  bundle=$(find "$out/_expo/static/js/$p" \( -name '*.hbc' -o -name '*.js' \) | head -n 1)
  [ -f "$bundle" ] || fail "$p: no JS bundle in $out"
  LC_ALL=C grep -aqF "$API_URL" "$bundle" || fail "$p: bundle does not contain the API URL"
  LC_ALL=C grep -aqF "$BUNDLE_MARKER" "$bundle" || fail "$p: bundle does not contain the app's routes"
  # Android starts this task from a background service (notification capture): it must stay registered.
  if [ "$p" = android ]; then LC_ALL=C grep -aqF "JoyoArtoCapture" "$bundle" || fail "android: headless capture task missing from the bundle"; fi
  echo "   bundle $(basename "$bundle") $(stat -c %s "$bundle" 2> /dev/null || stat -f %z "$bundle") bytes"

  step "3. $p: eas update --channel $channel (runtimeVersion $(runtime "$p"))"
  "${EAS[@]}" update --channel "$channel" --platform "$p" --message "$message" \
    --skip-bundler --input-dir "$out" --environment "$channel" \
    --non-interactive --json > "$json"
  local group
  group=$(jq -r '[.[]? | .group] | map(select(. != null)) | .[0] // empty' "$json")
  [ -n "$group" ] || { cat "$json" >&2; fail "$p: eas update printed no update group id"; }
  rm -f "$json"
  RESULTS+=("$p  channel=$channel  runtimeVersion=$(runtime "$p")  group=$group")
}

RESULTS=()
if [ "$platform" = all ]; then
  publish android
  publish ios
else
  publish "$platform"
fi

step "published"
printf '%s\n' "${RESULTS[@]}"
echo "view:     bunx eas-cli update:view <group>   (dashboard: https://expo.dev/accounts/dzulfikar08/projects/joyoarto/updates)"
echo "rollback: bunx eas-cli update:rollback <group> --non-interactive   (the group must be the latest of its runtimeVersion; docs/ota.md)"
