// Import by email (web: routes/-email-import.tsx): the household's private address (copy, new address, turn off) and
// the last emails it received. Hidden when the server has no email domain.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Alert, Linking, View } from "react-native";

import { SessionOnlyNote, useHasSession } from "@/components/session-only";
import { Button, Card, Divider, ErrorState, Pill, Row, SkeletonCard, Text } from "@/components/ui";
import { proOnlyNote, type BillingStatus } from "@/src/lib/billing";
import { errorMessage } from "@/src/lib/errors";
import { shortDateTime } from "@/src/lib/format";
import { describeInbound, inboundStatus } from "@/src/lib/imports";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";

type EmailStatus = Awaited<ReturnType<typeof client.imports.email.get>>;

export function EmailIn({ billing }: { billing: BillingStatus | undefined }) {
  const qc = useQueryClient();
  const hasSession = useHasSession();
  const q = useQuery({ ...orpc.imports.email.get.queryOptions(), enabled: hasSession });
  const done = (message: string) => (data: EmailStatus) => {
    qc.setQueryData(orpc.imports.email.get.queryKey(), data);
    toast.success(message);
  };
  const fail = (title: string) => (e: unknown) => toast.error(title, errorMessage(e, { storeSafe }));
  const regenerate = useMutation({ mutationFn: () => client.imports.email.regenerate(), onSuccess: done("New address ready"), onError: fail("Couldn't create an address") });
  const disable = useMutation({ mutationFn: () => client.imports.email.disable(), onSuccess: done("Email import turned off"), onError: fail("Couldn't turn it off") });
  const s = q.data;
  if (s && !s.available) return null;
  const proOnly = billing ? !billing.limits.emailImport : false;

  const copy = async (address: string) => {
    try {
      await Clipboard.setStringAsync(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy", address);
    }
  };

  return (
    <Card title="Import by email" subtitle="Forward statement PDFs to your household's private address">
      <Text tone="muted">
        Bank Jago monthly statements and GoPay e-statements (PDF) sent here are imported right away, and you get a summary back. Only mail from a member's own email address is read.
      </Text>
      {!hasSession ? <SessionOnlyNote /> : q.isPending ? <SkeletonCard lines={2} /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
      {s?.enabled && s.address ? (
        <>
          <View style={{ gap: 8 }}>
            <Text selectable variant="label" style={{ fontVariant: ["tabular-nums"] }} accessibilityLabel={`Import address ${s.address}`}>
              {s.address}
            </Text>
            <Button title="Copy address" icon="copy-outline" variant="secondary" small onPress={() => void copy(s.address!)} />
          </View>
          <Text variant="caption" tone="muted">
            Keep it private, like a password. Gmail can forward automatically: Settings → Forwarding, add this address; the confirmation code shows up below. Password-protected PDFs
            (BCA, Mandiri) cannot be read by email yet.
          </Text>
          <Row>
            <Button
              title="New address"
              variant="outline"
              small
              flex
              loading={regenerate.isPending}
              onPress={() =>
                Alert.alert("Make a new address?", "The current one stops working at once; update any forwarding rules.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "New address", onPress: () => regenerate.mutate() },
                ])
              }
            />
            <Button
              title="Turn off"
              variant="destructive"
              small
              flex
              loading={disable.isPending}
              onPress={() =>
                Alert.alert("Turn off email import?", "Mail to this address will bounce.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Turn off", style: "destructive", onPress: () => disable.mutate() },
                ])
              }
            />
          </Row>
        </>
      ) : s && proOnly ? (
        <>
          <Text variant="caption" tone="warning">{proOnlyNote("Import by email", { storeSafe })}</Text>
          {!storeSafe && billing?.proUrl ? <Button title="Joyo Pro in JoyoRogo" icon="open-outline" variant="ghost" small onPress={() => void Linking.openURL(billing.proUrl!)} /> : null}
        </>
      ) : s ? (
        <Button title="Get an import address" icon="mail-outline" loading={regenerate.isPending} onPress={() => regenerate.mutate()} />
      ) : null}

      {s?.recent.length ? (
        <>
          <Divider />
          <Text variant="label">Recent emails</Text>
          {s.recent.map((r) => {
            const st = inboundStatus(r.status);
            const text = describeInbound(r.status, r.detail);
            return (
              <View key={r.id} style={{ gap: 2, paddingVertical: 4 }}>
                <Row>
                  <Pill label={st.label} tone={st.tone} />
                  <Text variant="caption" tone="muted" style={{ marginLeft: "auto" }}>{shortDateTime(r.createdAt)}</Text>
                </Row>
                <Text numberOfLines={2}>{r.subject || "(no subject)"}</Text>
                <Text variant="caption" tone="muted" selectable>
                  {r.fromAddress}
                  {text ? ` · ${text}` : ""}
                </Text>
              </View>
            );
          })}
        </>
      ) : null}
    </Card>
  );
}
