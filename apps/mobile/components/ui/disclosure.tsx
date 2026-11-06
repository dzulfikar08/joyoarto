import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Icon, Text, type IconName } from "./core";

/**
 * Collapsed-by-default row for explanations, how-it-works text and secondary detail (tables behind a chart), so a
 * screen shows its numbers first. Port of JoyoRogo's native Disclosure; the web has the same in @baroka/ui.
 * - default: its own card on the canvas;
 * - `plain`: no background, for use inside a card (a hairline separates it from the content above).
 * Plain strings in `children` are wrapped in muted caption text.
 */
export function Disclosure({
  title,
  icon,
  plain,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: IconName;
  plain?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={plain ? styles.plain : styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.head, pressed && { opacity: 0.7 }]}
      >
        {icon ? <Icon name={icon} size={16} tone="muted" /> : null}
        <Text variant="label" tone={plain ? "muted" : "default"} style={{ flex: 1 }}>
          {title}
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} tone="muted" />
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {typeof children === "string" ? (
            <Text variant="caption" tone="muted" style={styles.prose}>
              {children}
            </Text>
          ) : (
            children
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.card, borderRadius: theme.radius.card, paddingHorizontal: theme.spacing.lg },
  plain: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, marginTop: theme.spacing.xs },
  head: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  body: { gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
  prose: { lineHeight: 18 },
}));
