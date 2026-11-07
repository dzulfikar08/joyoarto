// Text faces of the phone app: Plus Jakarta Sans for words (as in JoyoRogo), Inter for figures. Anything styled with
// tabular-nums (amounts, dates in columns, counts) is drawn in Inter at the same weight, like the web's `tabular-nums`.

export const TEXT_FONTS = {
  regular: "PlusJakartaSans_500Medium",
  medium: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  heavy: "PlusJakartaSans_800ExtraBold",
} as const;

export const NUM_FONTS = {
  regular: "Inter_500Medium",
  medium: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  heavy: "Inter_800ExtraBold",
} as const;

const TO_NUM: Record<string, string> = Object.fromEntries(Object.entries(TEXT_FONTS).map(([w, f]) => [f, NUM_FONTS[w as keyof typeof NUM_FONTS]]));

/** The figures face for a text face (same weight); other faces stay as they are. */
export function numericFamily(family: string | undefined): string | undefined {
  return family ? (TO_NUM[family] ?? family) : family;
}

/** True when a flattened text style asks for tabular figures. */
export function wantsFigures(style: { fontVariant?: string | readonly string[] } | null | undefined): boolean {
  const v = style?.fontVariant;
  return typeof v === "string" ? v.split(/\s+/).includes("tabular-nums") : !!v?.includes("tabular-nums");
}
