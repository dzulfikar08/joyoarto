// Joyo AI tab. Follow-up: the chat (joyo.* procedures, streamed answers, proposal cards with Confirm/Dismiss), ported
// from the web's apps/web/src/routes/joyo.tsx and JoyoRogo's phone chat. Until then, the add sheet covers quick capture.

import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { Button, Card, EmptyState, Screen, Text } from "@/components/ui";
import { openAddSheet } from "@/src/lib/add-sheet";

export default function JoyoTab() {
  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <Screen>
        <Text variant="title" accessibilityRole="header">Joyo AI</Text>
        <EmptyState
          icon="sparkles-outline"
          title="Ask about your money"
          description="“How much did we spend on food this month?”, “Can we afford a car?” Joyo AI reads your household ledger and suggests changes you confirm."
          action={<Button title="Quick add instead" variant="secondary" small icon="add" onPress={() => openAddSheet()} />}
        />
        <Card title="Coming to the app">
          <Text tone="muted">The chat is on the web today (Joyo AI) and in Claude through the JoyoArto connector. It is coming to this tab next.</Text>
        </Card>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.background },
}));
