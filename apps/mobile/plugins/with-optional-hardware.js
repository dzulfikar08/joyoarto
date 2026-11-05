// Declares the camera and microphone as optional hardware on Android.
//
// expo-image-picker adds android.permission.CAMERA (receipt photos) and expo-audio adds RECORD_AUDIO (voice quick add).
// Without a matching <uses-feature>, Google Play treats those permissions as needing android.hardware.camera,
// android.hardware.camera.autofocus and android.hardware.microphone, and hides the app from every device that lacks
// one of them. That happened with the receipt photos build: 411 fewer supported devices. The app works without both:
// receipts can come from the gallery and quick add can be typed, so the features are required="false".
const { withAndroidManifest } = require("expo/config-plugins");

const OPTIONAL_FEATURES = ["android.hardware.camera", "android.hardware.camera.autofocus", "android.hardware.microphone"];

module.exports = function withOptionalHardware(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const features = (manifest["uses-feature"] ??= []);
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((f) => f.$?.["android:name"] === name);
      if (existing) existing.$["android:required"] = "false";
      else features.push({ $: { "android:name": name, "android:required": "false" } });
    }
    return cfg;
  });
};
