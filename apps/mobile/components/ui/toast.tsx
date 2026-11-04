import { useEffect } from "react";
import { Platform, Pressable, View, useWindowDimensions } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { useObservable } from "@/src/lib/observable";
import { floatingTabBarFootprint } from "@/src/lib/tab-bar-metrics";
import { toast, type ToastItem } from "@/src/lib/toast";

import { Icon, Text } from "./core";

/** Draws the toasts (src/lib/toast.ts) above the tab bar. Mounted once in the root layout. */
export function ToastHost() {
  const items = useObservable(toast.store);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const bottom = floatingTabBarFootprint(fontScale, insets.bottom, Platform.OS) + 8;
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom }]}>
      {items.map((t) => (
        <ToastView key={t.id} item={t} />
      ))}
    </View>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  useEffect(() => {
    const timer = setTimeout(() => toast.dismiss(item.id), item.durationMs);
    return () => clearTimeout(timer);
  }, [item.id, item.durationMs]);
  styles.useVariants({ tone: item.tone === "default" ? undefined : item.tone });
  return (
    <Animated.View entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(150)}>
      <Pressable onPress={() => toast.dismiss(item.id)} style={styles.toast} accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={[item.title, item.description].filter(Boolean).join(". ")}>
        <Icon name={item.tone === "error" ? "alert-circle" : item.tone === "success" ? "checkmark-circle" : "information-circle"} tone={item.tone === "error" ? "destructive" : item.tone === "success" ? "positive" : "primary"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label">{item.title}</Text>
          {item.description ? <Text variant="caption" tone="muted" numberOfLines={3}>{item.description}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  host: { position: "absolute", left: 16, right: 16, gap: 8, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: "100%",
    maxWidth: 480,
    backgroundColor: theme.colors.card,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    variants: {
      tone: {
        success: {},
        error: { borderColor: theme.colors.destructiveSoft },
      },
    },
  },
}));
