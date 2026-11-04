import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { errorMessage, isNetworkError } from "@/src/lib/errors";
import { storeSafe } from "@/src/lib/platform";

import { Button, Icon, Text, type IconName } from "./core";

/** Nothing to show yet: an icon, a line of why, and what to do about it. */
export function EmptyState({ icon = "file-tray-outline", title, description, action }: { icon?: IconName; title: string; description?: string; action?: ReactNode }) {
  return (
    <View style={styles.box}>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={26} tone="primary" />
      </View>
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {description ? (
        <Text tone="muted" style={styles.center}>
          {description}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

/** A failed load, with Try again. Offline gets its own wording; cached data (if any) stays visible above it. */
export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const offline = isNetworkError(error);
  if (compact) {
    return (
      <View style={styles.compact} accessibilityRole="alert">
        <Icon name={offline ? "cloud-offline-outline" : "alert-circle-outline"} tone="destructive" size={18} />
        <Text variant="caption" tone="destructive" style={{ flex: 1 }}>
          {offline ? "Offline: showing what was last loaded." : errorMessage(error, { storeSafe })}
        </Text>
        {onRetry ? <Button title="Retry" variant="ghost" small onPress={onRetry} /> : null}
      </View>
    );
  }
  return (
    <View style={styles.box} accessibilityRole="alert">
      <View style={[styles.iconCircle, styles.iconDanger]}>
        <Icon name={offline ? "cloud-offline-outline" : "alert-circle-outline"} size={26} tone="destructive" />
      </View>
      <Text variant="heading" style={styles.center}>
        {offline ? "You're offline" : "Couldn't load this"}
      </Text>
      <Text tone="muted" style={styles.center}>
        {offline ? "Connect to the internet and try again." : errorMessage(error, { storeSafe })}
      </Text>
      {onRetry ? <Button title="Try again" variant="secondary" small onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { alignItems: "center", gap: theme.spacing.sm, paddingVertical: theme.spacing.xl, paddingHorizontal: theme.spacing.lg, backgroundColor: theme.colors.card, borderRadius: theme.radius.card },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primarySoft, marginBottom: 4 },
  iconDanger: { backgroundColor: theme.colors.destructiveSoft },
  center: { textAlign: "center" },
  compact: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.colors.destructiveSoft, borderRadius: theme.radius.tile, paddingHorizontal: 12, paddingVertical: 6 },
}));
