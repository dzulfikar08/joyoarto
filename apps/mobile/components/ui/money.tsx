import type { TextProps } from "react-native";

import { formatMoney } from "@/src/lib/format";

import { Text, type TextVariant, type Tone } from "./core";

/**
 * An amount in minor units, Indonesian notation ("Rp 25.000"). Prefer the API's own `display` when the row has one.
 * `signed`: money in is green with a "+", money out plain (the web's convention); otherwise the tone you pass.
 */
export function Money({
  amount,
  currency = "IDR",
  display,
  signed,
  tone,
  variant = "body",
  style,
  ...rest
}: Omit<TextProps, "children"> & { amount: number; currency?: string; display?: string; signed?: boolean; tone?: Tone; variant?: TextVariant }) {
  const text = display ?? formatMoney(amount, currency);
  const shown = signed && amount > 0 && !text.startsWith("+") ? `+${text}` : text;
  return (
    <Text
      variant={variant}
      tone={tone ?? (signed && amount > 0 ? "positive" : "default")}
      style={[{ fontVariant: ["tabular-nums"] }, style]}
      accessibilityLabel={`${amount < 0 ? "minus " : ""}${text.replace(/^-/, "")}`}
      numberOfLines={1}
      {...rest}
    >
      {shown}
    </Text>
  );
}
