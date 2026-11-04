import { useEffect } from "react";
import { View, type DimensionValue } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

/** A grey placeholder that pulses while data loads (still with Reduce Motion on). */
export function Skeleton({ width = "100%", height = 16, radius = 8 }: { width?: DimensionValue; height?: number; radius?: number }) {
  const reduce = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    opacity.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, reduce]);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.block, { width, height, borderRadius: radius }, pulse]} />;
}

/** A card-shaped placeholder: a title line and `lines` rows. */
export function SkeletonCard({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <View style={styles.card} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {height ? (
        <Skeleton height={height} radius={16} />
      ) : (
        <>
          <Skeleton width="40%" height={18} />
          {Array.from({ length: lines }, (_, i) => (
            <Skeleton key={i} width={i % 2 ? "70%" : "90%"} />
          ))}
        </>
      )}
    </View>
  );
}

/** Placeholder rows for a list (transactions). */
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.card} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width={i % 2 ? "55%" : "70%"} />
            <Skeleton width="35%" height={12} />
          </View>
          <Skeleton width={80} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: { backgroundColor: theme.colors.muted },
  card: { backgroundColor: theme.colors.card, borderRadius: theme.radius.card, padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 4 },
}));
