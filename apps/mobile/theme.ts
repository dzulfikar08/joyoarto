/**
 * JoyoArto tokens for native, converted from packages/ui/src/styles/globals.css (oklch → sRGB hex) on the
 * JoyoRogo v2 base: warm paper canvas, white cards, deep-indigo "arto blue" primary, gold coin accent.
 * Semantic colours only (positive = money in, destructive = errors/out, warning = needs attention).
 */
const shared = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 },
  radius: { card: 20, tile: 14, input: 14, pill: 999 },
  fontSize: { xs: 12, sm: 13, base: 15, md: 16, lg: 18, xl: 20, "2xl": 24, title: 28, hero: 36 },
  fonts: {
    regular: "PlusJakartaSans_500Medium",
    medium: "PlusJakartaSans_600SemiBold",
    bold: "PlusJakartaSans_700Bold",
    heavy: "PlusJakartaSans_800ExtraBold",
  },
} as const;

export const lightTheme = {
  colors: {
    background: "#f9f6f1",
    foreground: "#1d1a14",
    card: "#ffffff",
    muted: "#f3f0e9",
    mutedForeground: "#67635a",
    border: "#e4e1da",
    input: "#dedad3",
    overlay: "rgba(29,26,20,0.45)",
    primary: "#3752ae",
    primaryForeground: "#fafcff",
    primarySoft: "#e6eeff",
    primaryInk: "#283f92",
    /** The balance card (Home, Accounts): primary in light mode, the deep primary-soft in dark. */
    hero: "#3752ae",
    heroForeground: "#fafcff",
    destructive: "#d02c2a",
    destructiveSoft: "#ffe7e4",
    destructiveInk: "#9e1618",
    positive: "#007e46",
    positiveSoft: "#ddf6e4",
    positiveInk: "#00572e",
    warning: "#e49e22",
    warningSoft: "#fef0d4",
    warningInk: "#7a4702",
    coin: "#eebc4a",
    coinInk: "#754b00",
    segment: "#ffffff",
    shadow: "#1d1a15",
  },
  /** Charts (packages/ui --viz-*): six categorical series, the previous period, grid/axis, good/bad deltas. */
  viz: {
    series: ["#3d5fd6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#8a5cd0"],
    seriesTrack: "#d6def9",
    previous: "#a8a69f",
    grid: "#ebe7e0",
    axis: "#c9c4b9",
    muted: "#77706a",
    goodText: "#006300",
    badText: "#c42f2f",
    warning: "#fab219",
    critical: "#d03b3b",
  },
  ...shared,
} as const;

export const darkTheme = {
  colors: {
    background: "#110f0b",
    foreground: "#f4f1ec",
    card: "#1d1a15",
    muted: "#292621",
    mutedForeground: "#a8a49c",
    border: "rgba(255,255,255,0.10)",
    input: "rgba(255,255,255,0.14)",
    overlay: "rgba(8,7,4,0.6)",
    primary: "#8aa8f7",
    primaryForeground: "#0a1023",
    primarySoft: "#212c4c",
    primaryInk: "#bdd0ff",
    hero: "#212c4c",
    heroForeground: "#f4f1ec",
    destructive: "#fa6863",
    destructiveSoft: "#4b1d1b",
    destructiveInk: "#ffbdb7",
    positive: "#59c886",
    positiveSoft: "#173523",
    positiveInk: "#a1e3b7",
    warning: "#edb345",
    warningSoft: "#3f2c10",
    warningInk: "#f3d392",
    coin: "#f1c45e",
    coinInk: "#f3d392",
    segment: "#45413a",
    shadow: "#000000",
  },
  viz: {
    series: ["#6f8cf0", "#d95926", "#199e70", "#c98500", "#d55181", "#a283e6"],
    seriesTrack: "#263257",
    previous: "#6f6d66",
    grid: "#34312c",
    axis: "#4a463f",
    muted: "#a8a29e",
    goodText: "#0ca30c",
    badText: "#e66767",
    warning: "#fab219",
    critical: "#d03b3b",
  },
  ...shared,
} as const;

export type AppTheme = typeof lightTheme | typeof darkTheme;
