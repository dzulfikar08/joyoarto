// One chat turn, after the web's components/joyo/message.tsx: the member's bubble, Joyo's answer as markdown with the
// tools it read ("Reading budgets…" while it works), and the changes it proposed as cards with Confirm and Dismiss.

import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Icon, Row, Text } from "@/components/ui";
import { argLine, stepsLabel, toolWords } from "@/src/lib/joyo";
import type { LiveStep, Proposal } from "@/src/lib/joyo-stream";

import { JoyoMarkdown } from "./markdown";

export function Steps({ steps, streaming }: { steps: readonly LiveStep[]; streaming?: boolean }) {
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const label = stepsLabel(steps, !!streaming);
  if (!label) return null;
  const busy = !!streaming && steps.some((s) => s.running);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen(!open)}
        hitSlop={8}
        style={styles.chip}
      >
        {busy ? <ActivityIndicator size="small" color={theme.colors.mutedForeground} /> : <Icon name="checkmark" size={14} tone="muted" />}
        <Text variant="caption" tone="muted" style={styles.chipText}>
          {label}
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} tone="muted" />
      </Pressable>
      {open ? (
        <View style={styles.stepList}>
          {steps.map((s) => (
            <Text key={s.id} variant="caption" tone={!s.ok && !s.running ? "destructive" : "muted"}>
              <Text variant="caption" style={styles.chipText} tone={!s.ok && !s.running ? "destructive" : "muted"}>
                {toolWords(s.tool)}
              </Text>
              {argLine(s.args) ? `  ${argLine(s.args)}` : ""}
              {!s.ok && !s.running ? " (failed)" : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ProposalCard({ proposal, onAct, busy }: { proposal: Proposal; onAct?: (action: "confirm" | "dismiss") => void; busy?: boolean }) {
  styles.useVariants({ proposal: proposal.status === "done" ? "done" : proposal.status === "failed" ? "failed" : undefined });
  return (
    <View style={styles.proposal} accessibilityLabel={`${proposal.title}: ${proposal.summary}`}>
      <Text variant="caption" tone="muted" style={styles.upper}>
        {proposal.title}
      </Text>
      <Text variant="label">{proposal.summary}</Text>
      {proposal.result ? (
        <Text variant="caption" tone={proposal.status === "failed" ? "destructive" : "positive"}>
          {proposal.result}
        </Text>
      ) : null}
      {proposal.status === "dismissed" ? <Text variant="caption" tone="muted">Dismissed</Text> : null}
      {proposal.status === "pending" && onAct ? (
        <Row style={{ marginTop: 6 }}>
          <Button title="Confirm" icon="checkmark" small loading={busy} onPress={() => onAct("confirm")} />
          <Button title="Dismiss" icon="close" small variant="secondary" disabled={busy} onPress={() => onAct("dismiss")} />
        </Row>
      ) : null}
    </View>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userText} selectable>
          {text}
        </Text>
      </View>
    </View>
  );
}

export function AssistantTurn({
  text,
  steps,
  proposals,
  streaming,
  onProposal,
  busyProposal,
}: {
  text: string;
  steps: readonly LiveStep[];
  proposals: readonly Proposal[];
  streaming?: boolean;
  onProposal?: (proposal: Proposal, action: "confirm" | "dismiss") => void;
  busyProposal?: string | null;
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.assistantRow}>
      <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no">
        <Icon name="sparkles" size={16} tone="primary" />
      </View>
      <View style={styles.assistantBody}>
        <Steps steps={steps} streaming={streaming} />
        {text ? (
          <JoyoMarkdown text={text} streaming={streaming} />
        ) : streaming ? (
          <Row>
            <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
            <Text tone="muted">Thinking…</Text>
          </Row>
        ) : null}
        {proposals.map((p) => (
          <ProposalCard key={p.id} proposal={p} busy={busyProposal === p.id} onAct={onProposal ? (a) => onProposal(p, a) : undefined} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 32 },
  chipText: { fontFamily: theme.fonts.medium },
  stepList: { borderLeftWidth: 2, borderLeftColor: theme.colors.border, paddingLeft: 10, gap: 4, marginTop: 2 },
  proposal: {
    borderRadius: theme.radius.tile,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 14,
    gap: 4,
    variants: {
      proposal: {
        done: { backgroundColor: theme.colors.positiveSoft, borderColor: theme.colors.positiveSoft },
        failed: { backgroundColor: theme.colors.destructiveSoft, borderColor: theme.colors.destructiveSoft },
      },
    },
  },
  upper: { textTransform: "uppercase", letterSpacing: 0.5, fontFamily: theme.fonts.medium },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBubble: { maxWidth: "85%", backgroundColor: theme.colors.primary, borderRadius: 22, borderBottomRightRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  userText: { color: theme.colors.primaryForeground },
  assistantRow: { flexDirection: "row", gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.primarySoft, alignItems: "center", justifyContent: "center", marginTop: 2 },
  assistantBody: { flex: 1, minWidth: 0, gap: 8 },
}));
