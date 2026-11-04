// Joyo Pro status (web: routes/-billing.tsx). Android: "Manage in JoyoRogo" opens the browser. iOS (storeSafe): status
// only, no prices, purchase wording or outbound link (App Review 3.1.1; src/lib/billing.ts decides what shows).

import { useQuery } from "@tanstack/react-query";
import { Linking } from "react-native";

import { Button, Card, ErrorState, Pill, SkeletonCard, Text } from "@/components/ui";
import { billingView } from "@/src/lib/billing";
import { orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";

export function BillingCard() {
  const q = useQuery(orpc.billing.status.queryOptions());
  if (q.isPending) return <SkeletonCard lines={2} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  const v = q.data ? billingView(q.data, { storeSafe }) : null;
  if (!v) return null;
  return (
    <Card title={storeSafe ? "Plan" : "Billing"} action={<Pill label={v.plan === "pro" ? "Pro" : "Free"} tone={v.plan === "pro" ? "primary" : "muted"} />}>
      <Text>{v.line}</Text>
      {v.notes.map((n) => (
        <Text key={n} variant="caption" tone="muted">{n}</Text>
      ))}
      {v.usage.map((u) => (
        <Text key={u} variant="caption" tone="muted">• {u}</Text>
      ))}
      {v.manage ? <Button title={v.manage.label} icon="open-outline" variant={v.plan === "pro" ? "secondary" : "primary"} small onPress={() => void Linking.openURL(v.manage!.url)} /> : null}
    </Card>
  );
}
