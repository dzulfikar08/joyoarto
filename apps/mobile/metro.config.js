const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The repo uses bun's isolated installs: a package can link its own peer variant of expo/react/react-native
// (expo-router does). Resolve these singletons from the app itself so the bundle has exactly one copy of each.
const SINGLETONS = /^(react|react-native|expo|expo-modules-core|expo-constants|expo-linking|expo-router|expo-font|expo-asset|react-native-reanimated|react-native-worklets|react-native-screens|react-native-safe-area-context|react-native-unistyles|react-native-nitro-modules)(\/.*)?$/;
const appOrigin = path.join(__dirname, "package.json");
const expoOrigin = path.join(path.dirname(require.resolve("expo/package.json")), "package.json");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (SINGLETONS.test(moduleName)) {
    for (const origin of [appOrigin, expoOrigin]) {
      try {
        return context.resolveRequest({ ...context, originModulePath: origin }, moduleName, platform);
      } catch {
        // not reachable from this origin; try the next
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
