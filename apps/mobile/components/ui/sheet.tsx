import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { IconButton, Text } from "./core";

/**
 * A bottom sheet: slides up over a dimmed screen, closes on the backdrop, the close button and Android back.
 * Content scrolls when it is taller than ~90% of the screen; `scroll={false}` when it brings its own list.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  scroll = true,
  footer,
  fullHeight,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  /** Pinned under the content (Save buttons). */
  footer?: ReactNode;
  /** Take the full available height (long lists). */
  fullHeight?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, fullHeight && styles.full, { paddingBottom: Math.max(insets.bottom, 16) }]} accessibilityViewIsModal>
          <View style={styles.grabber} />
          {title ? (
            <View style={styles.header}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading" accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? <Text variant="caption" tone="muted">{subtitle}</Text> : null}
              </View>
              <IconButton name="close" label="Close" onPress={onClose} />
            </View>
          ) : null}
          {scroll ? (
            <ScrollView style={styles.flexShrink} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.flexShrink, fullHeight && { flex: 1 }]}>{children}</View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.overlay },
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    maxHeight: rt.screen.height * 0.92 - rt.insets.top,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  full: { height: rt.screen.height * 0.92 - rt.insets.top },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.border, marginBottom: theme.spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  flexShrink: { flexShrink: 1 },
  body: { gap: theme.spacing.md, paddingBottom: theme.spacing.md },
  footer: { paddingTop: theme.spacing.sm, gap: theme.spacing.sm },
}));
