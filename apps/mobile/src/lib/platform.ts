import { Platform } from "react-native";

/**
 * App Store builds (iOS) never point to buying Joyo Pro outside the app (App Review 3.1.1 / 3.1.3): no link to the web
 * app, and the server's "Joyo Pro ... bought in JoyoRogo" limit messages are replaced (docs/ios-release.md).
 */
export const storeSafe = Platform.OS === "ios";
