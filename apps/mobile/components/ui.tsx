import { Ionicons } from "@expo/vector-icons";
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text as RNText,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

// JoyoArto native kit on the JoyoRogo v2 base: paper canvas, borderless white cards, one arto-blue primary.
// Semantic colours only: positive = money in / done, destructive = errors, warning = needs a look.

export type IconName = ComponentProps<typeof Ionicons>["name"];
type Tone = "default" | "muted" | "primary" | "positive" | "destructive" | "warning";

export function Text({ variant = "body", tone = "default", style, ...rest }: TextProps & { variant?: "title" | "heading" | "body" | "label" | "caption" | "hero"; tone?: Tone }) {
  styles.useVariants({ variant, tone: tone === "default" ? undefined : tone });
  return <RNText {...rest} style={[styles.text, style]} />;
}

export function Screen({ children, scroll = true, refreshing, onRefresh }: { children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void }) {
  if (!scroll) return <SafeAreaView edges={["bottom", "left", "right"]} style={styles.screen}>{children}</SafeAreaView>;
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, tone = "default", onPress }: { children: ReactNode; tone?: "default" | "primary" | "warning" | "destructive"; onPress?: () => void }) {
  styles.useVariants({ cardTone: tone === "default" ? undefined : tone });
  const body = <View style={styles.card}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{body}</Pressable> : body;
}

export function Row({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: object }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Spacer({ size = 12 }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  small,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  const { theme } = useUnistyles();
  styles.useVariants({ button: variant, small });
  const fg = variant === "primary" ? theme.colors.primaryForeground : variant === "destructive" ? theme.colors.destructive : theme.colors.primaryInk;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <RNText style={[styles.buttonText, { color: fg }]}>{title}</RNText>
    </Pressable>
  );
}

export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { theme } = useUnistyles();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <TextInput placeholderTextColor={theme.colors.mutedForeground} {...input} style={[styles.input, input.multiline && { minHeight: 80, textAlignVertical: "top" }]} />
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
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: theme.colors.primary, false: theme.colors.input }}
        thumbColor={theme.colors.card}
      />
    </Row>
  );
}

export function Pill({ label, tone = "muted", icon }: { label: string; tone?: "muted" | "primary" | "positive" | "warning" | "destructive"; icon?: IconName }) {
  const { theme } = useUnistyles();
  styles.useVariants({ pill: tone });
  const ink = { muted: theme.colors.mutedForeground, primary: theme.colors.primaryInk, positive: theme.colors.positiveInk, warning: theme.colors.warningInk, destructive: theme.colors.destructiveInk }[tone];
  return (
    <View style={styles.pill}>
      {icon ? <Ionicons name={icon} size={12} color={ink} /> : null}
      <RNText style={[styles.pillText, { color: ink }]}>{label}</RNText>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segment, o.value === value && styles.segmentOn]}>
          <Text variant="label" tone={o.value === value ? "default" : "muted"}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export type SelectOption = { value: string; label: string; hint?: string };

/** A field that opens a searchable list in a sheet. */
export function Select({ label, value, options, onChange, placeholder = "Choose", allowClear, clearLabel = "None" }: { label: string; value: string | null | undefined; options: SelectOption[]; onChange: (v: string | null) => void; placeholder?: string; allowClear?: boolean; clearLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { theme } = useUnistyles();
  const current = options.find((o) => o.value === value);
  const shown = options.filter((o) => !q || `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <Pressable onPress={() => setOpen(true)} style={[styles.input, { flexDirection: "row", alignItems: "center" }]}>
        <Text style={{ flex: 1 }} tone={current ? "default" : "muted"} numberOfLines={1}>{current?.label ?? placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={theme.colors.mutedForeground} />
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text variant="heading">{label}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}><Ionicons name="close" size={22} color={theme.colors.foreground} /></Pressable>
          </Row>
          {options.length > 8 ? <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={theme.colors.mutedForeground} style={styles.input} /> : null}
          <FlatList
            data={allowClear ? [{ value: "", label: clearLabel }, ...shown] : shown}
            keyExtractor={(o) => o.value || "__none"}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item.value || null);
                  setOpen(false);
                  setQ("");
                }}
                style={styles.option}
              >
                <View style={{ flex: 1 }}>
                  <Text>{item.label}</Text>
                  {item.hint ? <Text variant="caption" tone="muted">{item.hint}</Text> : null}
                </View>
                {(item.value || null) === (value ?? null) ? <Ionicons name="checkmark" size={20} color={theme.colors.primary} /> : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

export function Icon({ name, size = 20, tone = "default" }: { name: IconName; size?: number; tone?: Tone }) {
  const { theme } = useUnistyles();
  const color = { default: theme.colors.foreground, muted: theme.colors.mutedForeground, primary: theme.colors.primary, positive: theme.colors.positive, destructive: theme.colors.destructive, warning: theme.colors.warningInk }[tone];
  return <Ionicons name={name} size={size} color={color} />;
}

export function Loading() {
  const { theme } = useUnistyles();
  return (
    <View style={{ padding: 40, alignItems: "center" }}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

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
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
    variants: {
      cardTone: {
        default: {},
        primary: { backgroundColor: theme.colors.primarySoft },
        warning: { backgroundColor: theme.colors.warningSoft },
        destructive: { backgroundColor: theme.colors.destructiveSoft },
      },
    },
  },
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
      },
      small: { true: { minHeight: 36, paddingHorizontal: 14 } },
    },
  },
  buttonText: { fontFamily: theme.fonts.bold, fontSize: theme.fontSize.base },
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
  pillText: { fontFamily: theme.fonts.medium, fontSize: theme.fontSize.xs },
  segmented: { flexDirection: "row", backgroundColor: theme.colors.muted, borderRadius: theme.radius.pill, padding: 3 },
  segment: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: theme.radius.pill },
  segmentOn: { backgroundColor: theme.colors.card },
  overlay: { flex: 1, backgroundColor: theme.colors.overlay },
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    maxHeight: "75%",
  },
  option: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: 8 },
}));
