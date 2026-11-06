// The bank-app style balance card on Home and Accounts: total balance, a thin bar and legend splitting it by account
// type, and optional content under it (Home's month stats). Primary card in light mode, deep primary-soft in dark
// (theme.colors.hero); white overlays only, so no status colours on it.

import type { ComponentProps, ReactNode } from "react";
import { Text as RNText, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { BalanceSegment } from "@/src/lib/dashboard";

/** Bar and legend shades, largest group first. */
const SHADES = ["rgba(255,255,255,1)", "rgba(255,255,255,0.6)", "rgba(255,255,255,0.35)", "rgba(255,255,255,0.2)"];
const shade = (i: number) => SHADES[Math.min(i, SHADES.length - 1)];

export function BalanceCard({ total, caption, split, children }: { total: string; caption?: string; split: BalanceSegment[]; children?: ReactNode }) {
  const summary = `Total balance ${total}. ${split.map((s) => `${s.label} ${s.display}`).join(", ")}`;
  return (
    <View style={styles.card}>
      <View accessible accessibilityLabel={summary}>
        <HeroText style={styles.label}>Total balance</HeroText>
        <HeroText style={styles.total} numberOfLines={1} adjustsFontSizeToFit>
          {total}
        </HeroText>
        {caption ? <HeroText style={styles.caption}>{caption}</HeroText> : null}
        {split.length ? (
          <>
            <View style={styles.bar}>
              {split.map((s, i) => (
                <View key={s.type} style={{ flex: s.share, backgroundColor: shade(i) }} />
              ))}
            </View>
            <View style={styles.legend}>
              {split.map((s, i) => (
                <View key={s.type} style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: shade(i) }]} />
                  <HeroText style={styles.legendLabel}>{s.label}</HeroText>
                  <HeroText style={styles.legendValue}>{s.display}</HeroText>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** One figure in the 2x2 grid under the balance. */
export function HeroStat({ label, value, delta, accessibilityLabel }: { label: string; value: string; delta: ReactNode; accessibilityLabel?: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={accessibilityLabel}>
      <HeroText style={styles.statLabel}>{label}</HeroText>
      <HeroText style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </HeroText>
      {delta}
    </View>
  );
}

export function HeroGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** Text on the card: the card's foreground, `faint` for secondary lines. */
export function HeroText({ style, faint, strong, ...rest }: ComponentProps<typeof RNText> & { faint?: boolean; strong?: boolean }) {
  return <RNText maxFontSizeMultiplier={1.4} {...rest} style={[styles.text, faint && styles.faint, strong && styles.strong, style]} />;
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.hero, borderRadius: theme.radius.card, padding: theme.spacing.lg, gap: theme.spacing.lg },
  text: { color: theme.colors.heroForeground, fontFamily: theme.fonts.regular, fontSize: theme.fontSize.xs, fontVariant: ["tabular-nums"] },
  faint: { opacity: 0.7 },
  strong: { fontFamily: theme.fonts.medium },
  label: { fontFamily: theme.fonts.medium, fontSize: theme.fontSize.sm, opacity: 0.75 },
  total: { fontFamily: theme.fonts.heavy, fontSize: 32, letterSpacing: -0.5, marginTop: 2 },
  caption: { opacity: 0.7 },
  bar: { flexDirection: "row", height: 6, gap: 2, borderRadius: 3, overflow: "hidden", marginTop: theme.spacing.lg },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: theme.spacing.lg, rowGap: 6, marginTop: theme.spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { opacity: 0.75 },
  legendValue: { fontFamily: theme.fonts.medium },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  stat: { width: "48.5%", flexGrow: 1, minWidth: 0, borderRadius: theme.radius.tile, backgroundColor: "rgba(255,255,255,0.1)", padding: theme.spacing.md, gap: 2 },
  statLabel: { fontFamily: theme.fonts.medium, opacity: 0.75 },
  statValue: { fontFamily: theme.fonts.heavy, fontSize: theme.fontSize.md },
}));
