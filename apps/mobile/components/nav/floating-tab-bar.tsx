import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  ADD_OUTER,
  ADD_RAISE,
  ADD_RING,
  ADD_SLOT,
  TAB_BAR_BORDER,
  TAB_BAR_MARGIN_X,
  TAB_BAR_MAX_WIDTH,
  TAB_BAR_PADDING,
  TAB_ICON_SIZE,
  TAB_ITEM_PADDING,
  TAB_LABEL_LINE,
  TAB_LABEL_MAX_SCALE,
  TAB_LABEL_SIZE,
  tabBarBottomOffset,
  tabBarPillHeight,
  tabItemHeight,
} from "@/src/lib/tab-bar-metrics";

/** The route that is the centre Add button instead of a tab (app/(tabs)/add.tsx). */
export const ADD_ROUTE = "add";
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** True while the Android keyboard is up: the window resizes with it, so the bar would ride above the keyboard. */
function useAndroidKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

function TabItem({ focused, height, label, badge, onPress, onLongPress, children }: { focused: boolean; height: number; label: string; badge?: string | number; onPress: () => void; onLongPress: () => void; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    progress.value = reduceMotion ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, { duration: 140, easing: EASE_OUT });
  }, [focused, progress, reduceMotion]);
  const indicator = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.92 + progress.value * 0.08 }] }));
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.item, { height, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
    >
      <Animated.View pointerEvents="none" style={[styles.indicator, indicator]} />
      <View style={styles.iconBox}>
        {children}
        {badge !== undefined ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{typeof badge === "number" && badge > 9 ? "9+" : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE} style={[styles.label, focused && styles.labelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The floating tab bar (ported from JoyoRogo's components/floating-tab-bar.tsx, matching the web's bottom-nav.tsx):
 * a rounded pill inset from the edges, lifted above the bottom inset, with the Add button raised out of its centre. It
 * floats over the screens; tab screens pad their content by `useTabContentInset()` (Screen does it). Hidden on Android
 * while the keyboard is open.
 */
export function FloatingTabBar({ state, descriptors, emitter, navigateToTab, insets, add }: BottomTabBarProps & { add: { label: string; onPress: () => void } }) {
  const { theme } = useUnistyles();
  const { fontScale } = useWindowDimensions();
  const sides = useSafeAreaInsets();
  const keyboardOpen = useAndroidKeyboardOpen();
  if (keyboardOpen) return null;
  const itemHeight = tabItemHeight(fontScale);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.strip,
        { paddingBottom: tabBarBottomOffset(insets.bottom, Platform.OS), paddingLeft: TAB_BAR_MARGIN_X + sides.left, paddingRight: TAB_BAR_MARGIN_X + sides.right },
      ]}
    >
      <View pointerEvents="box-none" style={styles.column}>
        <View accessibilityRole="tablist" style={[styles.pill, { height: tabBarPillHeight(fontScale) }]}>
          {state.routes.map((route, index) => {
            if (route.name === ADD_ROUTE) return <View key={route.key} style={styles.addSlot} />;
            const descriptor = descriptors[route.key];
            if (!descriptor) return null;
            const { options } = descriptor;
            const focused = index === state.index;
            const color = focused ? theme.colors.foreground : theme.colors.mutedForeground;
            const label = typeof options.tabBarLabel === "string" ? options.tabBarLabel : (options.title ?? route.name);
            const onPress = () => {
              const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            };
            return (
              <TabItem
                key={route.key}
                focused={focused}
                height={itemHeight}
                label={label}
                badge={options.tabBarBadge as string | number | undefined}
                onPress={onPress}
                onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
              >
                {options.tabBarIcon?.({ focused, color, size: TAB_ICON_SIZE })}
              </TabItem>
            );
          })}
        </View>
        <View pointerEvents="box-none" style={styles.addRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={add.label} onPress={add.onPress} style={({ pressed }) => [styles.add, { transform: [{ scale: pressed ? 0.92 : 1 }] }]}>
            <Ionicons name="add" size={30} color={theme.colors.primaryForeground} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
  column: { width: "100%", maxWidth: TAB_BAR_MAX_WIDTH, paddingTop: ADD_RAISE },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    padding: TAB_BAR_PADDING,
    borderWidth: TAB_BAR_BORDER,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: TAB_ITEM_PADDING },
  indicator: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.muted, borderRadius: theme.radius.pill },
  iconBox: { height: TAB_ICON_SIZE, minWidth: TAB_ICON_SIZE, alignItems: "center", justifyContent: "center" },
  label: { fontSize: TAB_LABEL_SIZE, lineHeight: TAB_LABEL_LINE, fontFamily: theme.fonts.medium, color: theme.colors.mutedForeground },
  labelActive: { color: theme.colors.foreground },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.destructive,
  },
  badgeText: { fontSize: 10, lineHeight: 12, fontWeight: "800", color: theme.colors.card },
  addSlot: { width: ADD_SLOT },
  addRow: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" },
  add: {
    width: ADD_OUTER,
    height: ADD_OUTER,
    borderRadius: ADD_OUTER / 2,
    borderWidth: ADD_RING,
    borderColor: theme.colors.card,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
}));
