import { Image } from "react-native";

/** The JoyoArto mark (apps/web/public/icon.svg, rendered to assets/images/splash-icon.png). */
export function BrandMark({ size = 40 }: { size?: number }) {
  return <Image source={require("@/assets/images/splash-icon.png")} style={{ width: size, height: size }} accessibilityLabel="JoyoArto" />;
}
