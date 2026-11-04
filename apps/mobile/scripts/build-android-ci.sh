#!/usr/bin/env bash
# Android APK for JoyoArto, built in GitHub Actions (.github/workflows/android.yml). Not meant for the laptop.
#
#   VARIANT=release|debug|play   release (default): JS bundled APK, runs without Metro. debug: needs `bun run dev` +
#                           adb reverse. play: signed AAB for Google Play (needs the keystore; versionCode = minutes since
#                           2024-01-01 UTC, as in JoyoRogo).
#   ARCHS=arm64-v8a         ABIs to build (comma-separated).
#   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
#                           optional: sign the release APK with this key. Without them the release APK is signed with
#                           the throwaway debug key (fine for sideloading tests, cannot update a store build).
#
# Output: dist/joyoarto-<variant>.apk, or dist/joyoarto-play-<versionCode>.aab, at the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
MOBILE="$(pwd)"
ROOT="$(cd ../.. && pwd)"
VARIANT="${VARIANT:-release}"
ARCHS="${ARCHS:-arm64-v8a}"
case "$VARIANT" in release|debug|play) ;; *) echo "VARIANT must be release, debug or play" >&2; exit 1 ;; esac
if [ "$VARIANT" = play ] && [ -z "${ANDROID_KEYSTORE_PATH:-}" ]; then echo "play builds need the release keystore" >&2; exit 1; fi
export VERSION_CODE="${VERSION_CODE:-$(( ($(date -u +%s) - 1704067200) / 60 ))}"

rm -rf android
bunx expo prebuild -p android --no-install

python3 - <<'PY'
import os, pathlib, re
props = pathlib.Path("android/gradle.properties")
p = props.read_text()
p = re.sub(r"reactNativeArchitectures=.*", "reactNativeArchitectures=" + os.environ["ARCHS"], p)
props.write_text(p)

# Every build gets a fresh versionCode so Play accepts it (same scheme as JoyoRogo, never collides).
app = pathlib.Path("android/app/build.gradle")
g = app.read_text()
g, n = re.subn(r"versionCode \d+", "versionCode " + os.environ["VERSION_CODE"], g, count=1)
if n != 1:
    raise SystemExit("versionCode not found in android/app/build.gradle")
app.write_text(g)

if os.environ.get("ANDROID_KEYSTORE_PATH"):
    app = pathlib.Path("android/app/build.gradle")
    s = app.read_text()
    release = """
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }"""
    s, n = re.subn(r"(signingConfigs \{)", r"\1" + release, s, count=1)
    if n != 1:
        raise SystemExit("signingConfigs block not found in android/app/build.gradle")
    # The template's release build type signs with the debug key; switch it to the release key.
    head, sep, tail = s.partition("buildTypes {")
    tail, m = re.subn(r"(release \{[^}]*?)signingConfig signingConfigs\.debug", r"\1signingConfig signingConfigs.release", tail, count=1, flags=re.S)
    if m != 1:
        raise SystemExit("release build type signing line not found")
    app.write_text(head + sep + tail)
    print("release APK will be signed with the provided keystore")
else:
    print("no keystore: release APK is signed with the debug key")
PY

cd android
if [ "$VARIANT" = play ]; then
  ./gradlew bundleRelease
  AAB=app/build/outputs/bundle/release/app-release.aab
  mkdir -p "$ROOT/dist"
  cp "$AAB" "$ROOT/dist/joyoarto-play-$VERSION_CODE.aab"
  MAP=app/build/outputs/mapping/release/mapping.txt
  [ -f "$MAP" ] && cp "$MAP" "$ROOT/dist/mapping-play.txt"
  # The upload key must be the release key, never the debug one.
  "$JAVA_HOME/bin/jarsigner" -verify -verbose -certs "$ROOT/dist/joyoarto-play-$VERSION_CODE.aab" | grep -q "CN=JoyoArto" || { echo "AAB is not signed with the JoyoArto release key" >&2; exit 1; }
  # The upload key's SHA-1 (an Android OAuth client for Google Sign-In needs it; Play's app-signing SHA-1 is in Play Console).
  "$JAVA_HOME/bin/keytool" -printcert -jarfile "$ROOT/dist/joyoarto-play-$VERSION_CODE.aab" | grep -E "SHA1:|SHA-1:" | sed 's/^/upload key /' || true
  ls -la "$ROOT/dist/joyoarto-play-$VERSION_CODE.aab"
  exit 0
fi
if [ "$VARIANT" = release ]; then
  ./gradlew assembleRelease
  SRC=app/build/outputs/apk/release/app-release.apk
else
  ./gradlew assembleDebug
  SRC=app/build/outputs/apk/debug/app-debug.apk
fi

AAPT2="$(ls "$ANDROID_HOME"/build-tools/*/aapt2 | sort -V | tail -1)"
PKG="$("$AAPT2" dump packagename "$SRC")"
[ "$PKG" = "com.joyodigitama.joyoarto" ] || { echo "unexpected package $PKG" >&2; exit 1; }
# The capture service and the PDF share target must be in the merged manifest.
MANIFEST="$("$AAPT2" dump xmltree "$SRC" --file AndroidManifest.xml)"
grep -q "CaptureListenerService" <<<"$MANIFEST" || { echo "CaptureListenerService missing from the manifest" >&2; exit 1; }
grep -q "BIND_NOTIFICATION_LISTENER_SERVICE" <<<"$MANIFEST" || { echo "listener permission missing" >&2; exit 1; }
grep -q "application/pdf" <<<"$MANIFEST" || { echo "PDF share filter missing" >&2; exit 1; }

# Signing certificate SHA-1: Google Sign-In only works when an Android OAuth client (Cloud project joyorogo, package
# com.joyodigitama.joyoarto) has this fingerprint (docs/mobile-auth.md).
"$JAVA_HOME/bin/keytool" -printcert -jarfile "$SRC" | grep -E "SHA1:|SHA-1:" | sed 's/^/signing key /' || true

mkdir -p "$ROOT/dist"
cp "$SRC" "$ROOT/dist/joyoarto-$VARIANT.apk"
ls -la "$ROOT/dist/joyoarto-$VARIANT.apk"
