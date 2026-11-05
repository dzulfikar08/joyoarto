import { useMemo } from "react";
import { AccessibilityInfo, Platform, View } from "react-native";
import { Toaster, toast as sonner, type ToasterProps } from "sonner-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "react-native-unistyles";

import { setToastRenderer, type ToastSpec } from "@/src/lib/toast";

import { Icon, type IconName } from "./core";

// src/lib/toast.ts decides where a toast goes; sonner-native draws it (swipe up to dismiss, stacking, enter/exit).
setToastRenderer({
  show(spec: ToastSpec, onGone: () => void) {
    const opts = { description: spec.description, duration: spec.durationMs, toasterId: spec.host, onDismiss: onGone, onAutoClose: onGone };
    const handle = spec.tone === "success" ? sonner.success(spec.title, opts) : spec.tone === "error" ? sonner.error(spec.title, opts) : sonner.info(spec.title, opts);
    // Android reads the toast through sonner-native's aria-live region; iOS has no live regions.
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility([spec.title, spec.description].filter(Boolean).join(". "));
    return handle;
  },
  dismiss: (handle) => void sonner.dismiss(handle),
});

/** Native-stack header bar height under the status bar (Material top app bar, UIKit navigation bar). */
const HEADER_BAR = Platform.OS === "ios" ? 44 : 56;

/**
 * The toast host. Mounted once in the root layout (on iOS inside sonner-native's FullWindowOverlay, so it is drawn
 * above native modals and sheets) and, on Android, inside every open Sheet's Modal with that sheet's `id`.
 *
 * Top centre, under the status bar; `belowHeader` (pushed stack screens) moves it under the header bar too.
 */
export function AppToaster({ id, belowHeader = false }: { id?: string; belowHeader?: boolean }) {
  const { theme, rt } = useUnistyles();
  const insets = useSafeAreaInsets();
  const offset = insets.top + (belowHeader ? HEADER_BAR : 0) + theme.spacing.sm;
  const dark = rt.themeName === "dark";
  const props = useMemo((): ToasterProps => {
    const c = theme.colors;
    const icon = (name: IconName, tone: "primary" | "positive" | "destructive", soft: string) => (
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: soft, alignItems: "center", justifyContent: "center" }}>
        <Icon name={name} size={20} tone={tone} />
      </View>
    );
    return {
      position: "top-center",
      offset,
      theme: dark ? "dark" : "light",
      visibleToasts: 3,
      gap: 8,
      swipeToDismissDirection: "up",
      closeButton: false,
      maxFontSizeMultiplier: 1.6,
      icons: {
        success: icon("checkmark", "positive", c.positiveSoft),
        error: icon("alert", "destructive", c.destructiveSoft),
        info: icon("information", "primary", c.primarySoft),
      },
      toastOptions: {
        // Solid and lifted: the card colour in light mode, one step lighter than cards in dark mode, with a real shadow.
        style: {
          backgroundColor: dark ? c.muted : c.card,
          borderRadius: theme.radius.card,
          borderWidth: 1,
          borderColor: c.border,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          shadowColor: c.shadow,
          shadowOpacity: dark ? 0.5 : 0.18,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        },
        error: { borderColor: c.destructive },
        toastContentStyle: { gap: theme.spacing.md, alignItems: "center" },
        titleStyle: { fontFamily: theme.fonts.medium, fontWeight: "normal", fontSize: theme.fontSize.base, lineHeight: 20, color: c.foreground },
        descriptionStyle: { fontFamily: theme.fonts.regular, fontSize: theme.fontSize.sm, lineHeight: 18, marginTop: 2, color: c.mutedForeground },
      },
    };
  }, [theme, dark, offset]);
  return <Toaster {...props} id={id} />;
}
