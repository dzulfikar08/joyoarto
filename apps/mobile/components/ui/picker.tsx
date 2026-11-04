import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, SectionList, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { filterOptions, findOption, optionCount, type PickerGroup, type PickerOption } from "@/src/lib/options";

import { FieldLabel, Input, Text } from "./core";
import { Sheet } from "./sheet";

export type { PickerGroup, PickerOption };

/** Lists longer than this get a search box (categories, accounts). */
const SEARCH_FROM = 8;

/**
 * A searchable picker in a sheet: categories (grouped by parent), accounts, anything long. Build items with
 * src/lib/options.ts (categoryOptions, accountOptions). `none` adds a first row that clears the value ("Uncategorized",
 * "All accounts"). Use `PickerButton` + `PickerSheet` directly for a compact trigger (a chip in a list row).
 */
export function Picker({
  label,
  value,
  groups,
  onChange,
  placeholder = "Choose",
  none,
  searchPlaceholder = "Search",
  hint,
  disabled,
}: {
  label: string;
  value: string | null | undefined;
  groups: PickerGroup[];
  onChange: (v: string | null) => void;
  placeholder?: string;
  /** Label of the "no value" row; omit to make a value required. */
  none?: string;
  searchPlaceholder?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = findOption(groups, value);
  return (
    <FieldLabel label={label} hint={hint}>
      <PickerButton label={label} text={current?.label ?? (value ? value : (none ?? placeholder))} muted={!current} onPress={() => setOpen(true)} disabled={disabled} />
      <PickerSheet open={open} onClose={() => setOpen(false)} title={label} value={value} groups={groups} onChange={onChange} none={none} searchPlaceholder={searchPlaceholder} />
    </FieldLabel>
  );
}

export function PickerButton({ label, text, muted, onPress, disabled, compact }: { label: string; text: string; muted?: boolean; onPress: () => void; disabled?: boolean; compact?: boolean }) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${text}`}
      accessibilityHint="Opens a list to choose from"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [compact ? styles.compact : styles.field, { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Text style={{ flexShrink: 1 }} variant={compact ? "label" : "body"} tone={muted ? "muted" : "default"} numberOfLines={1}>
        {text}
      </Text>
      <Ionicons name="chevron-down" size={compact ? 14 : 18} color={theme.colors.mutedForeground} />
    </Pressable>
  );
}

export function PickerSheet({
  open,
  onClose,
  title,
  value,
  groups,
  onChange,
  none,
  searchPlaceholder = "Search",
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string | null | undefined;
  groups: PickerGroup[];
  onChange: (v: string | null) => void;
  none?: string;
  searchPlaceholder?: string;
  footer?: React.ReactNode;
}) {
  const { theme } = useUnistyles();
  const [q, setQ] = useState("");
  const searchable = optionCount(groups) > SEARCH_FROM;
  const sections = useMemo(() => {
    const filtered = filterOptions(groups, q).map((g) => ({ title: g.label, data: g.options }));
    return none && !q.trim() ? [{ title: null, data: [{ value: "", label: none }] }, ...filtered] : filtered;
  }, [groups, q, none]);
  const close = () => {
    setQ("");
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title={title} scroll={false} fullHeight={searchable} footer={footer}>
      {searchable ? <Input value={q} onChangeText={setQ} placeholder={searchPlaceholder} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" accessibilityLabel={searchPlaceholder} /> : null}
      <SectionList
        style={{ marginTop: searchable ? 8 : 0 }}
        sections={sections}
        keyExtractor={(o, i) => `${o.value || "__none"}:${i}`}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        initialNumToRender={30}
        ListEmptyComponent={<Text tone="muted" style={{ paddingVertical: 16 }}>Nothing matches “{q}”.</Text>}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text variant="caption" tone="muted" style={styles.section}>
              {section.title.toUpperCase()}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const selected = (item.value || null) === (value || null);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => {
                onChange(item.value || null);
                close();
              }}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: theme.colors.muted }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text tone={item.value ? "default" : "muted"}>{item.label}</Text>
                {item.hint ? <Text variant="caption" tone="muted">{item.hint}</Text> : null}
              </View>
              {selected ? <Ionicons name="checkmark" size={20} color={theme.colors.primary} /> : null}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

/** The old flat Select (capture and import screens): a Picker with one ungrouped list. */
export type SelectOption = PickerOption;
export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose",
  allowClear,
  clearLabel = "None",
}: {
  label: string;
  value: string | null | undefined;
  options: SelectOption[];
  onChange: (v: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const groups = useMemo(() => [{ label: null, options }], [options]);
  return <Picker label={label} value={value} groups={groups} onChange={onChange} placeholder={placeholder} none={allowClear ? clearLabel : undefined} />;
}

const styles = StyleSheet.create((theme) => ({
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.input,
    borderWidth: 1,
    borderRadius: theme.radius.input,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  compact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    minHeight: 34,
  },
  section: { paddingTop: 16, paddingBottom: 4, fontFamily: theme.fonts.medium, letterSpacing: 0.5 },
  option: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, gap: 8 },
}));
