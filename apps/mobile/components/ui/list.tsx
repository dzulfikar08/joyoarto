import type { ReactNode } from "react";
import { Children, Fragment } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Icon, Text, type IconName, type Tone } from "./core";

/** A tappable row: optional icon or avatar, title and subtitle, a trailing value, a chevron when it navigates. */
export function ListRow({
  title,
  subtitle,
  icon,
  iconTone = "primary",
  left,
  right,
  onPress,
  chevron = !!onPress,
  destructive,
  accessibilityLabel,
  numberOfLines = 1,
}: {
  title: string;
  subtitle?: string | null;
  icon?: IconName;
  iconTone?: Tone;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  accessibilityLabel?: string;
  numberOfLines?: number;
}) {
  const { theme } = useUnistyles();
  const body = (
    <>
      {left ?? (icon ? <View style={styles.iconBox}><Icon name={icon} tone={destructive ? "destructive" : iconTone} /></View> : null)}
      <View style={styles.text}>
        <Text numberOfLines={numberOfLines} tone={destructive ? "destructive" : "default"} style={styles.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={numberOfLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <Icon name="chevron-forward" size={18} tone="muted" /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.colors.muted }]}
    >
      {body}
    </Pressable>
  );
}

/** A card of rows with hairlines between them, and an optional heading above. */
export function ListSection({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: 6 }}>
      {title ? (
        <Text variant="caption" tone="muted" style={styles.heading} accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={styles.card}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
      {footer ? <Text variant="caption" tone="muted" style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: 12, minHeight: 56 },
  iconBox: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primarySoft },
  text: { flex: 1, gap: 2, minWidth: 0 },
  title: { fontFamily: theme.fonts.medium },
  card: { backgroundColor: theme.colors.card, borderRadius: theme.radius.card, overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginLeft: theme.spacing.lg },
  heading: { paddingHorizontal: theme.spacing.xs, fontFamily: theme.fonts.medium, letterSpacing: 0.5 },
  footer: { paddingHorizontal: theme.spacing.xs },
}));
