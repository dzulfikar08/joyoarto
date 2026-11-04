import { useState } from "react";
import { Image, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./core";

/** The Google profile photo, else initials. */
export function Avatar({ name, image, size }: { name: string | null; image: string | null; size: number }) {
  const [failed, setFailed] = useState(false);
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (image && !failed && image.startsWith("https://")) {
    return <Image source={{ uri: image }} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text variant="label" tone="primary" style={{ fontSize: size * 0.38 }}>
        {initials || "?"}
      </Text>
    </View>
  );
}


const styles = StyleSheet.create((theme) => ({
  avatar: { backgroundColor: theme.colors.primarySoft, alignItems: "center", justifyContent: "center" },
}));
