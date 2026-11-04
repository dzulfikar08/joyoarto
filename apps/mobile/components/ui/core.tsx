import { Ionicons } from "@expo/vector-icons";
import { useContext, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text as RNText,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { BottomTabBarHeightContext } from "expo-router/js-tabs";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { tabContentInset } from "@/src/lib/tab-bar-metrics";

// JoyoArto native kit on the JoyoRogo v2 base: paper canvas, borderless white cards, one arto-blue primary.
// Semantic colours only: positive = money in / done, destructive = errors, warning = needs a look.
// Conventions for new screens: apps/mobile/AGENTS.md.

export type IconName = ComponentProps<typeof Ionicons>["name"];
export type Tone = "default" | "muted" | "primary" | "positive" | "destructive" | "warning";
export type TextVariant = "hero" | "title" | "heading" | "body" | "label" | "caption";

export function Text({ variant = "body", tone = "default", style, ...rest }: TextProps & { variant?: TextVariant; tone?: Tone }) {
  styles.useVariants({ variant, tone: tone === "default" ? undefined : tone });
  return <RNText maxFontSizeMultiplier={1.6} {...rest} style={[styles.text, style]} />;
}

/** True inside a tab screen: the floating bar covers the bottom of the screen. */
export function useInTabs(): boolean {
  return useContext(BottomTabBarHeightContext) !== undefined;
}

/** Bottom padding that keeps the last item clear of the floating tab bar (0 outside the tabs). */
export function useTabContentInset(): number {
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useInTabs() ? tabContentInset(fontScale, insets.bottom, Platform.OS) : 0;
}

/**
 * A screen's body: the canvas, safe-area sides, optional pull-to-refresh, and room for the floating tab bar.
 * `scroll={false}` for screens that bring their own list (FlatList / SectionList: pad with useTabContentInset()).
 */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  edges = ["left", "right"],
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: ("top" | "bottom" | "left" | "right")[];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { theme } = useUnistyles();
  const tabInset = useTabContentInset();
  const safeEdges = tabInset ? edges.filter((e) => e !== "bottom") : [...new Set([...edges, "bottom" as const])];
  if (!scroll) return <SafeAreaView edges={safeEdges} style={styles.screen}>{children}</SafeAreaView>;
  return (
    <SafeAreaView edges={safeEdges} style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, tabInset ? { paddingBottom: tabInset } : null, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

type CardTone = "default" | "primary" | "warning" | "destructive" | "positive" | "muted";

/** A white card. `title`/`subtitle`/`action` make the usual header row. */
export function Card({
  children,
  tone = "default",
  onPress,
  title,
  subtitle,
  action,
  padded = true,
  style,
  accessibilityLabel,
}: {
  children?: ReactNode;
  tone?: CardTone;
  onPress?: () => void;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  styles.useVariants({ cardTone: tone === "default" ? undefined : tone, padded });
  const header =
    title || action ? (
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          {title ? <Text variant="heading">{title}</Text> : null}
          {subtitle ? <Text variant="caption" tone="muted">{subtitle}</Text> : null}
        </View>
        {action}
      </View>
    ) : null;
  const body = (
    <View style={[styles.card, style]}>
      {header}
      {children}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Row({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Spacer({ size = 12 }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "outline";

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  small,
  flex,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  /** Grow to fill a Row. */
  flex?: boolean;
  accessibilityLabel?: string;
}) {
  const { theme } = useUnistyles();
  styles.useVariants({ button: variant, small });
  const fg =
    variant === "primary" ? theme.colors.primaryForeground : variant === "destructive" ? theme.colors.destructiveInk : variant === "outline" ? theme.colors.foreground : theme.colors.primaryInk;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, flex && { flex: 1 }, { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <RNText maxFontSizeMultiplier={1.4} style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]} numberOfLines={1}>
        {title}
      </RNText>
    </Pressable>
  );
}

/** A round icon-only button (header actions, close buttons). */
export function IconButton({ name, onPress, label, tone = "default", size = 22 }: { name: IconName; onPress: () => void; label: string; tone?: Tone; size?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={10} style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={name} size={size} tone={tone} />
    </Pressable>
  );
}

/** A bare text input in the kit's style. */
export function Input({ style, ...input }: TextInputProps) {
  const { theme } = useUnistyles();
  return (
    <TextInput
      placeholderTextColor={theme.colors.mutedForeground}
      maxFontSizeMultiplier={1.6}
      {...input}
      style={[styles.input, input.multiline && { minHeight: 80, textAlignVertical: "top" }, style]}
    />
  );
}

/** A labelled input with a hint or an error under it. */
export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <Input accessibilityLabel={label} {...input} />
      {error ? <Text variant="caption" tone="destructive">{error}</Text> : hint ? <Text variant="caption" tone="muted">{hint}</Text> : null}
    </View>
  );
}

/** Label above any control (pickers, segmented, dates), with the same hint/error line as Field. */
export function FieldLabel({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      {children}
      {error ? <Text variant="caption" tone="destructive">{error}</Text> : hint ? <Text variant="caption" tone="muted">{hint}</Text> : null}
    </View>
  );
}

export function SwitchRow({ label, hint, value, onValueChange, disabled }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  const { theme } = useUnistyles();
  return (
    <Row gap={12} style={{ paddingVertical: 6 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label">{label}</Text>
        {hint ? <Text variant="caption" tone="muted">{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: theme.colors.primary, false: theme.colors.input }}
        thumbColor={theme.colors.card}
      />
    </Row>
  );
}

export type PillTone = "muted" | "primary" | "positive" | "warning" | "destructive";

export function Pill({ label, tone = "muted", icon, onPress, selected }: { label: string; tone?: PillTone; icon?: IconName; onPress?: () => void; selected?: boolean }) {
  const { theme } = useUnistyles();
  styles.useVariants({ pill: selected ? "primary" : tone });
  const ink = {
    muted: theme.colors.mutedForeground,
    primary: theme.colors.primaryInk,
    positive: theme.colors.positiveInk,
    warning: theme.colors.warningInk,
    destructive: theme.colors.destructiveInk,
  }[selected ? "primary" : tone];
  const body = (
    <View style={[styles.pill, onPress && styles.pillTappable]}>
      {icon ? <Ionicons name={icon} size={onPress ? 14 : 12} color={ink} /> : null}
      <RNText maxFontSizeMultiplier={1.4} style={[styles.pillText, onPress && styles.pillTextTappable, { color: ink }]}>
        {label}
      </RNText>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} hitSlop={4}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="radio"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => onChange(o.value)}
          style={[styles.segment, o.value === value && styles.segmentOn]}
        >
          <Text variant="label" tone={o.value === value ? "default" : "muted"}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Icon({ name, size = 20, tone = "default", color }: { name: IconName; size?: number; tone?: Tone; color?: string }) {
  const { theme } = useUnistyles();
  const toneColor = {
    default: theme.colors.foreground,
    muted: theme.colors.mutedForeground,
    primary: theme.colors.primary,
    positive: theme.colors.positive,
    destructive: theme.colors.destructive,
    warning: theme.colors.warningInk,
  }[tone];
  return <Ionicons name={name} size={size} color={color ?? toneColor} />;
}

export function Loading({ label }: { label?: string }) {
  const { theme } = useUnistyles();
  return (
    <View style={{ padding: 40, alignItems: "center", gap: 8 }} accessibilityRole="progressbar" accessibilityLabel={label ?? "Loading"}>
      <ActivityIndicator color={theme.colors.primary} />
      {label ? <Text variant="caption" tone="muted">{label}</Text> : null}
    </View>
  );
}

/** @deprecated Use ErrorState (components/ui/states.tsx); kept for the capture and import screens. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card tone="destructive">
      <Text tone="destructive">{error instanceof Error ? error.message : String(error)}</Text>
      {onRetry ? <Button title="Try again" variant="ghost" small onPress={onRetry} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  text: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSize.base,
    variants: {
      variant: {
        hero: { fontFamily: theme.fonts.heavy, fontSize: theme.fontSize.hero, letterSpacing: -0.5 },
        title: { fontFamily: theme.fonts.heavy, fontSize: theme.fontSize.title, letterSpacing: -0.3 },
        heading: { fontFamily: theme.fonts.bold, fontSize: theme.fontSize.lg },
        body: {},
        label: { fontFamily: theme.fonts.medium, fontSize: theme.fontSize.sm },
        caption: { fontSize: theme.fontSize.xs },
      },
      tone: {
        default: {},
        muted: { color: theme.colors.mutedForeground },
        primary: { color: theme.colors.primaryInk },
        positive: { color: theme.colors.positive },
        destructive: { color: theme.colors.destructiveInk },
        warning: { color: theme.colors.warningInk },
      },
    },
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    gap: theme.spacing.sm,
    variants: {
      cardTone: {
        default: {},
        primary: { backgroundColor: theme.colors.primarySoft },
        warning: { backgroundColor: theme.colors.warningSoft },
        destructive: { backgroundColor: theme.colors.destructiveSoft },
        positive: { backgroundColor: theme.colors.positiveSoft },
        muted: { backgroundColor: theme.colors.muted },
      },
      padded: {
        true: { padding: theme.spacing.lg },
        false: { paddingVertical: theme.spacing.xs, overflow: "hidden" },
      },
    },
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm, marginBottom: theme.spacing.xs },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 20,
    minHeight: 48,
    variants: {
      button: {
        primary: { backgroundColor: theme.colors.primary },
        secondary: { backgroundColor: theme.colors.primarySoft },
        ghost: { backgroundColor: "transparent" },
        destructive: { backgroundColor: theme.colors.destructiveSoft },
        outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.input },
      },
      small: { true: { minHeight: 36, paddingHorizontal: 14 } },
    },
  },
  buttonText: { fontFamily: theme.fonts.bold, fontSize: theme.fontSize.base },
  buttonTextSmall: { fontSize: theme.fontSize.sm },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  input: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.input,
    borderWidth: 1,
    borderRadius: theme.radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSize.md,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    variants: {
      pill: {
        muted: { backgroundColor: theme.colors.muted },
        primary: { backgroundColor: theme.colors.primarySoft },
        positive: { backgroundColor: theme.colors.positiveSoft },
        warning: { backgroundColor: theme.colors.warningSoft },
        destructive: { backgroundColor: theme.colors.destructiveSoft },
      },
    },
  },
  pillTappable: { paddingHorizontal: 12, paddingVertical: 8, minHeight: 36 },
  pillText: { fontFamily: theme.fonts.medium, fontSize: theme.fontSize.xs },
  pillTextTappable: { fontSize: theme.fontSize.sm },
  segmented: { flexDirection: "row", backgroundColor: theme.colors.muted, borderRadius: theme.radius.pill, padding: 3 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: theme.radius.pill, minHeight: 40 },
  segmentOn: { backgroundColor: theme.colors.segment },
}));
