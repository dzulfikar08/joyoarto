// Dense form fields for the Plan editors (the web's MoneyInput, NumInput, MonthInput and Choice in routes/plan.tsx):
// rupiah with thousands dots, numbers that take an Indonesian comma, month + year pickers, and short choices.
// The text <-> value mapping is pure in src/lib/plan-state.ts.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Input, PickerButton, PickerSheet, Text, type PickerGroup } from "@/components/ui";
import { currentMonthWib, monthLabel } from "@/src/lib/format";
import { clamp, moneyText, monthOf, numText, parseMoneyText, parseNumText, yearChoices } from "@/src/lib/plan-state";

/** A small label above a control, with an optional hint under it. Fills a cell of a FieldGrid. */
export function Cell({ label, hint, children, wide }: { label: string; hint?: string | null; children: ReactNode; wide?: boolean }) {
  return (
    <View style={[styles.cell, wide && styles.wide]}>
      <Text variant="caption" tone="muted" style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      {children}
      {hint ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Two columns of cells on a phone. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** Rupiah in whole units with thousands dots while typing; empty means "not set". */
export function MoneyField({ value, onChange, label, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string; placeholder?: string }) {
  return (
    <Input
      style={styles.input}
      value={moneyText(value)}
      onChangeText={(t) => onChange(parseMoneyText(t))}
      placeholder={placeholder}
      keyboardType="number-pad"
      accessibilityLabel={label}
      maxLength={19}
    />
  );
}

/**
 * A number. Keeps its own text so "2," can be typed on the way to "2,5". Empty is 0, or undefined with `optional`.
 * Values outside min/max are clamped.
 */
export function NumField({
  value,
  onChange,
  label,
  placeholder,
  min = 0,
  max = 1_000,
  optional,
  disabled,
  integer,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  label: string;
  placeholder?: string;
  min?: number;
  max?: number;
  optional?: boolean;
  disabled?: boolean;
  integer?: boolean;
}) {
  const [text, setText] = useState(numText(value));
  useEffect(() => {
    // Follow outside changes (a reset, a template) unless the text already means this value.
    if (parseNumText(text) !== value) setText(numText(value));
  }, [value]);
  return (
    <Input
      style={[styles.input, disabled && { opacity: 0.5 }]}
      value={text}
      editable={!disabled}
      onChangeText={(t) => {
        setText(t);
        const v = parseNumText(t);
        if (v === null) return;
        if (v === undefined) onChange(optional ? undefined : 0);
        else onChange(clamp(integer ? Math.round(v) : v, min, max));
      }}
      placeholder={placeholder}
      keyboardType={integer ? "number-pad" : "decimal-pad"}
      accessibilityLabel={label}
      maxLength={8}
    />
  );
}

/** A short list as a compact picker (rate type, funded from, tenor). */
export function ChoiceField<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo<PickerGroup[]>(() => [{ label: null, options: options.map(([v, l]) => ({ value: v, label: l })) }], [options]);
  const current = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <>
      <PickerButton label={label} text={current} onPress={() => setOpen(true)} />
      <PickerSheet open={open} onClose={() => setOpen(false)} title={label} value={value} groups={groups} onChange={(v) => v && onChange(v as T)} />
    </>
  );
}

const MONTH_GROUPS: PickerGroup[] = [{ label: null, options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthLabel(`2000-${String(i + 1).padStart(2, "0")}`).replace(" 2000", "") })) }];

/** Month and year as two compact pickers. `optional` adds a clearing row ("–") to the month. */
export function MonthField({ value, onChange, label, optional }: { value: string | undefined; onChange: (v: string | undefined) => void; label: string; optional?: boolean }) {
  const [open, setOpen] = useState<"month" | "year" | null>(null);
  const thisMonth = currentMonthWib();
  const year = value ? Number(value.slice(0, 4)) : undefined;
  const month = value ? Number(value.slice(5, 7)) : undefined;
  const years = useMemo<PickerGroup[]>(() => [{ label: null, options: yearChoices(thisMonth, value).map((y) => ({ value: String(y), label: String(y) })) }], [thisMonth, value]);
  const fallbackYear = Number(thisMonth.slice(0, 4));
  return (
    <View style={styles.monthRow}>
      <View style={{ flex: 1 }}>
        <PickerButton label={`${label}: month`} text={month ? monthLabel(value!, "short") : optional ? "–" : "Month"} muted={!month} onPress={() => setOpen("month")} />
      </View>
      <View style={{ flex: 1 }}>
        <PickerButton label={`${label}: year`} text={year ? String(year) : optional ? "–" : "Year"} muted={!year} onPress={() => setOpen("year")} />
      </View>
      <PickerSheet
        open={open === "month"}
        onClose={() => setOpen(null)}
        title={`${label}: month`}
        value={month ? String(month) : null}
        groups={MONTH_GROUPS}
        none={optional ? "– (not set)" : undefined}
        onChange={(v) => (v ? onChange(monthOf(year ?? fallbackYear, Number(v))) : optional ? onChange(undefined) : undefined)}
      />
      <PickerSheet
        open={open === "year"}
        onClose={() => setOpen(null)}
        title={`${label}: year`}
        value={year ? String(year) : null}
        groups={years}
        onChange={(v) => v && onChange(monthOf(Number(v), month ?? 1))}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5, rowGap: 12 },
  cell: { width: "50%", paddingHorizontal: 5, gap: 4 },
  wide: { width: "100%" },
  label: { fontFamily: theme.fonts.medium },
  hint: { fontSize: 11 },
  input: { minHeight: 48, paddingVertical: 8, fontSize: theme.fontSize.base },
  monthRow: { flexDirection: "row", gap: 4 },
}));
