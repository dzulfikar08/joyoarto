#!/usr/bin/env bash
# JoyoArto iOS App Store build, run ON macOS with Xcode: the GitHub macOS runner of .github/workflows/release-ios.yml.
# Not meant for the laptop (owner rule: no local Xcode/pod builds). Ported from JoyoRogo's scripts/ios/mac-build.sh.
#
#   apps/mobile/scripts/ios/build-ios.sh            prebuild, pods, archive, export, check dist/ios/JoyoArto.ipa
#   apps/mobile/scripts/ios/build-ios.sh --upload   ...then upload it to App Store Connect (TestFlight) with altool
#
# Needs on PATH: node, bun, pod (CocoaPods), ruby with the xcodeproj gem (CocoaPods brings it), Xcode 26+.
# Env:
#   EXPORT_PROFILE   name of the installed App Store profile for com.joyodigitama.joyoarto (the workflow fetches it with
#                    asc-ci-profile.py). Set: manual signing (archive and export). Unset: automatic, through the API key.
#   BUILD_NUMBER     CFBundleVersion, YYYYMMDDHHMM in UTC by default (same scheme as JoyoRogo, never collides)
#   ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH   App Store Connect API key; default path is
#                    ~/.appstoreconnect/private_keys/AuthKey_<id>.p8 (mode 600, never in git)
#   IOS_BUILD_OUT    output directory (default <repo>/dist/ios)
#
# Signing, as JoyoRogo: with EXPORT_PROFILE the app target is set to the Apple Distribution identity in the keychain and
# that App Store profile before the archive, and the export uses them too, so xcodebuild never signs in to the account
# (JoyoRogo saw the API-key login inside xcodebuild fail on 2026-10-24 while the REST API still worked). Without it,
# both steps sign automatically through the API key (-allowProvisioningUpdates), which needs cloud-signing rights.
#
# The app has one target and no extensions: the iOS share extension of expo-share-intent is off (disableIOS in app.json,
# docs/ios-release.md "Share extension"), and the notification-capture module is Android-only (its
# expo-module.config.json lists only android, so iOS autolinking never sees it).
set -euo pipefail
MOBILE=$(cd "$(dirname "$0")/../.." && pwd)
REPO=$(cd "$MOBILE/../.." && pwd)
cd "$REPO"
mode=${1:-}
OUT=${IOS_BUILD_OUT:-$REPO/dist/ios}

APP=JoyoArto
BUNDLE_ID=com.joyodigitama.joyoarto
TEAM_ID=F6Q6UFUK69
IOS_DIR=$MOBILE/ios
# The live API the app talks to by default (apps/mobile/src/lib/api.ts DEFAULT_SERVER); the IPA check looks for it.
API_URL=https://app.arto.joyorogo.com
# A string literal from app code (app/login.tsx): a bundle without it was bundled without the routes.
BUNDLE_MARKER="Without finance:write the app can show balances"

: "${ASC_KEY_ID:?set ASC_KEY_ID}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
export ASC_KEY_PATH=${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}
BUILD_NUMBER=${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
[ -f "$ASC_KEY_PATH" ] || { echo "no App Store Connect key at $ASC_KEY_PATH" >&2; exit 1; }
for tool in node bun pod ruby xcodebuild xcrun; do
  command -v "$tool" > /dev/null || { echo "$tool is not on PATH" >&2; exit 1; }
done
export LANG=en_US.UTF-8
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
MANUAL=0
if [ -n "${EXPORT_PROFILE:-}" ]; then
  MANUAL=1
  AUTH=()
fi

step() { printf '\n== %s ==\n' "$*"; }
START=$SECONDS
lap() { printf '   [%dm%02ds]\n' $(((SECONDS - START) / 60)) $(((SECONDS - START) % 60)); }

# Metro keeps its caches in the temp dir; JoyoRogo once got a bundle with no routes from a stale one (a blank app, no
# error). Own temp dir per build, old caches removed.
rm -rf "$OUT"
mkdir -p "$OUT/tmp"
rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"metro-* "$(getconf DARWIN_USER_TEMP_DIR)"haste-map-* 2> /dev/null || true
export TMPDIR=$OUT/tmp

step "Toolchain"
xcodebuild -version | tr '\n' ' '; echo
echo "node $(node -v), bun $(bun -v), pod $(pod --version 2> /dev/null | tail -n1), ruby $(ruby -e 'print RUBY_VERSION')"
echo "$APP $(git rev-parse --short HEAD) build $BUILD_NUMBER"

step "1. bun install --frozen-lockfile"
bun install --frozen-lockfile 2>&1 | tail -n 3
lap

export NODE_ENV=production

step "2. expo prebuild --platform ios --clean"
(cd "$MOBILE" && bunx expo prebuild --platform ios --clean --no-install 2>&1 | tail -n 3)
PLIST=$IOS_DIR/$APP/Info.plist
[ -f "$PLIST" ] || { echo "prebuild did not write $PLIST" >&2; exit 1; }
# Prebuild writes app.json's buildNumber into Info.plist as a literal, so the build setting does not reach it.
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$PLIST"
# expo-dev-client's launcher only runs in Debug, but its plugin adds Bonjour and a local-network prompt text (English,
# about Metro) to every build. A store build must not carry a permission text for something it never does.
/usr/libexec/PlistBuddy -c "Delete :NSBonjourServices" "$PLIST" 2> /dev/null || true
/usr/libexec/PlistBuddy -c "Delete :NSLocalNetworkUsageDescription" "$PLIST" 2> /dev/null || true
lap

step "3. pod install"
(cd "$IOS_DIR" && EXPO_PRECOMPILED_FLAVOR=release pod install > "$OUT/pod-install.log" 2>&1) ||
  { tail -n 40 "$OUT/pod-install.log" >&2; exit 1; }
# React Native's pod install merges the pods' privacy manifests into the app's PrivacyInfo.xcprivacy (the one prebuild
# writes from app.json ios.privacyManifests). Keep a copy for the log artifact.
cp "$IOS_DIR/$APP/PrivacyInfo.xcprivacy" "$OUT/PrivacyInfo.xcprivacy" 2> /dev/null || true
lap

if [ "$MANUAL" = 1 ]; then
  step "3b. manual signing for $APP ($EXPORT_PROFILE)"
  # Only the app target: a command-line PROVISIONING_PROFILE_SPECIFIER would also hit the Pods targets.
  ruby -rxcodeproj -e1 2> /dev/null || gem install --user-install --no-document xcodeproj > /dev/null
  ruby -rxcodeproj -e '
    proj = Xcodeproj::Project.open(ARGV[0])
    target = proj.targets.find { |t| t.name == ARGV[1] } or abort("no target #{ARGV[1]}")
    target.build_configurations.each do |c|
      s = c.build_settings
      s["CODE_SIGN_STYLE"] = "Manual"
      s["CODE_SIGN_IDENTITY"] = "Apple Distribution"
      s.delete("CODE_SIGN_IDENTITY[sdk=iphoneos*]")
      s["DEVELOPMENT_TEAM"] = ARGV[3]
      s["PROVISIONING_PROFILE_SPECIFIER"] = ARGV[2]
    end
    proj.save' "$IOS_DIR/$APP.xcodeproj" "$APP" "$EXPORT_PROFILE" "$TEAM_ID"
fi

step "4. xcodebuild archive"
# The log goes to a file; the console gets each target once, signing lines and errors.
progress() {
  awk '
    /^\*\* / || /error:/ || /[Pp]rovisioning [Pp]rofile|Signing Identity/ { print; fflush(); next }
    match($0, /\(in target .[^'"'"']+/) {
      t = substr($0, RSTART + 12, RLENGTH - 12)
      if (!(t in seen)) { seen[t] = 1; print "   " t; fflush() }
    }'
}
xcodebuild archive -workspace "$IOS_DIR/$APP.xcworkspace" -scheme "$APP" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/$APP.xcarchive" ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  > "$OUT/xcodebuild-archive.log" 2>&1 < /dev/null &
build=$!
tail -n +1 -F "$OUT/xcodebuild-archive.log" 2> /dev/null | progress &
follow=$!
if ! wait "$build"; then
  sleep 1; kill "$follow" 2> /dev/null || true
  grep -E 'error:|\*\* ARCHIVE FAILED' "$OUT/xcodebuild-archive.log" | head -n 20 >&2
  echo "archive failed; full log: $OUT/xcodebuild-archive.log" >&2
  exit 1
fi
sleep 1; kill "$follow" 2> /dev/null || true
lap

step "5. xcodebuild -exportArchive (app-store-connect)"
if [ "$MANUAL" = 1 ]; then
  SIGNING="<key>signingStyle</key><string>manual</string>
  <key>provisioningProfiles</key><dict>
    <key>$BUNDLE_ID</key><string>$EXPORT_PROFILE</string>
  </dict>"
else
  SIGNING="<key>signingStyle</key><string>automatic</string>"
fi
cat > "$OUT/ExportOptions.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM_ID</string>
  $SIGNING
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>stripSwiftSymbols</key><true/>
  <key>uploadSymbols</key><false/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/$APP.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" ${AUTH[@]+"${AUTH[@]}"} > "$OUT/xcodebuild-export.log" 2>&1 ||
  { tail -n 30 "$OUT/xcodebuild-export.log" >&2; exit 1; }
IPA=$OUT/$APP.ipa
cp "$OUT/export/$APP.ipa" "$IPA"
lap

step "6. Check the IPA"
CHECK=$OUT/ipa
rm -rf "$CHECK" && mkdir -p "$CHECK" && unzip -q "$IPA" -d "$CHECK"
APPDIR=$CHECK/Payload/$APP.app
plist() { /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2> /dev/null; }
fail() { echo "CHECK FAILED: $*" >&2; exit 1; }
INFO=$APPDIR/Info.plist

[ "$(plist "$INFO" CFBundleIdentifier)" = "$BUNDLE_ID" ] || fail "bundle id is not $BUNDLE_ID"
[ "$(plist "$INFO" CFBundleVersion)" = "$BUILD_NUMBER" ] || fail "CFBundleVersion is not $BUILD_NUMBER"
[ "$(plist "$INFO" CFBundleDisplayName)" = "$APP" ] || fail "display name is not $APP"
[ "$(plist "$INFO" ITSAppUsesNonExemptEncryption)" = false ] || fail "ITSAppUsesNonExemptEncryption is not false"
[ "$(plist "$INFO" NSAppTransportSecurity:NSAllowsArbitraryLoads)" != true ] || fail "ATS allows arbitrary loads"
sdk=$(plist "$INFO" DTSDKName)
case $sdk in iphoneos2[6-9]* | iphoneos[3-9]*) ;; *) fail "built with $sdk, App Store Connect wants the iOS 26 SDK or later" ;; esac

# Permission texts: the app asks for none (document picker and Keychain need none). A key here means a plugin added a
# prompt the app never shows, which App Review questions; add it to app.json on purpose or remove the plugin.
usage=$(plutil -convert xml1 -o - "$INFO" | grep -oE '<key>NS[A-Za-z]+UsageDescription</key>' | sed -E 's/<\/?key>//g' | tr '\n' ' ' || true)
[ -z "$usage" ] || fail "unexpected permission texts in Info.plist: $usage"

# No extensions: the share extension is off on iOS, nothing else is embedded.
[ ! -d "$APPDIR/PlugIns" ] || fail "the app embeds extensions ($(ls "$APPDIR/PlugIns" | tr '\n' ' ')) but signing covers one bundle id"

# Privacy manifest: app.json's ios.privacyManifests plus the pods' manifests, merged by pod install.
PRIV=$APPDIR/PrivacyInfo.xcprivacy
[ -f "$PRIV" ] || fail "no PrivacyInfo.xcprivacy in the app"
[ "$(plist "$PRIV" NSPrivacyTracking)" = false ] || fail "privacy manifest: NSPrivacyTracking is not false"
priv_types=$(plutil -convert xml1 -o - "$PRIV" | grep -oE 'NSPrivacyAccessedAPICategory[A-Za-z]+' | sort -u | tr '\n' ' ' || true)
for t in UserDefaults FileTimestamp SystemBootTime DiskSpace; do
  grep -q "NSPrivacyAccessedAPICategory$t" <<< "$priv_types" || fail "privacy manifest lacks the $t required-reason entry"
done
echo "   privacy manifest: $priv_types"

# Entitlements and profile: an App Store profile has no device list and no get-task-allow.
security cms -D -i "$APPDIR/embedded.mobileprovision" > "$OUT/profile.plist"
[ -z "$(plist "$OUT/profile.plist" ProvisionedDevices)" ] || fail "embedded profile lists devices (not an App Store profile)"
codesign -d --entitlements :- "$APPDIR" > "$OUT/entitlements.plist" 2> /dev/null
[ "$(plist "$OUT/entitlements.plist" get-task-allow)" = false ] || fail "get-task-allow is not false"
codesign --verify --deep --strict "$APPDIR" || fail "code signature does not verify"
authority=$(codesign -dvv "$APPDIR" 2>&1 | sed -n 's/^Authority=\(Apple Distribution.*\)/\1/p')
[ -n "$authority" ] || fail "not signed with an Apple Distribution identity"
echo "   $BUNDLE_ID $(plist "$INFO" CFBundleShortVersionString) ($BUILD_NUMBER), $sdk, $authority"

# Android-only native code must not be in the iOS app.
if LC_ALL=C strings -a "$APPDIR/$APP" | grep -q NotificationCaptureModule; then
  fail "the Android notification-capture module ended up in the iOS executable"
fi

# app.config freshness: Constants.expoConfig reads the embedded app.config at run time.
(cd "$MOBILE" && bunx expo config --type public --json) > "$OUT/expo-config.json"
node -e '
  const fs = require("fs");
  const want = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const have = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const keys = ["name", "slug", "version", "scheme"];
  const stale = keys.filter((k) => JSON.stringify(have[k]) !== JSON.stringify(want[k]));
  if (stale.length) { console.error("EXConstants app.config is out of date with app.json (" + stale.join(", ") + ")"); process.exit(1); }
' "$OUT/expo-config.json" "$APPDIR/EXConstants.bundle/app.config" || fail "stale app.config"

# Bundle sanity: app code present (Metro cache guard) and the live API URL inlined.
[ -f "$APPDIR/main.jsbundle" ] || fail "no main.jsbundle in the app"
STRINGS=$(LC_ALL=C strings -a "$APPDIR/main.jsbundle")
grep -qF "$BUNDLE_MARKER" <<< "$STRINGS" || fail "main.jsbundle holds no app code (Metro bundled without the routes)"
grep -qF "$API_URL" <<< "$STRINGS" || fail "main.jsbundle does not contain the API URL $API_URL"
echo "   main.jsbundle $(stat -f %z "$APPDIR/main.jsbundle") bytes, app code present, API URL inlined"
ls -l "$IPA" | awk '{print "   ipa " $5 " bytes"}'
lap

echo "ipa: $IPA"

if [ "$mode" = --upload ]; then
  step "7. Upload to App Store Connect (altool)"
  # altool reads AuthKey_<id>.p8 from ~/.appstoreconnect/private_keys; ASC_KEY_PATH has to be there.
  [ "$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)" = "$HOME/.appstoreconnect/private_keys" ] ||
    { echo "altool needs the key in ~/.appstoreconnect/private_keys" >&2; exit 1; }
  xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1
  echo "uploaded: $APP $BUILD_NUMBER"
  lap
fi
