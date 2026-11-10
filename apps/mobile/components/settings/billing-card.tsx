// Joyo Pro status (web: routes/-billing.tsx). Android: "Manage in JoyoRogo" opens the browser. iOS (storeSafe): never
// points outside the app (App Review 3.1.1); Joyo Pro is bought with In-App Purchase on the Joyo Pro screen.

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Linking } from "react-native";

import { Button, Card, ErrorState, Pill, SkeletonCard, Text } from "@/components/ui";
import { appleIapAvailable } from "@/src/lib/apple-iap";
import { billingView } from "@/src/lib/billing";
import { orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";

export function BillingCard() {
  const router = useRouter();
  const q = useQuery(orpc.billing.status.queryOptions());
  if (q.isPending) return <SkeletonCard lines={2} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  const v = q.data ? billingView(q.data, { storeSafe }) : null;
  if (!v) return null;
  return (
    <Card title={storeSafe ? "Joyo Pro" : "Billing"} action={<Pill label={v.plan === "pro" ? "Pro" : "Free"} tone={v.plan === "pro" ? "primary" : "muted"} />}>
      <Text>{v.line}</Text>
      {v.notes.map((n) => (
        <Text key={n} variant="caption" tone="muted">{n}</Text>
      ))}
      {v.usage.map((u) => (
        <Text key={u} variant="caption" tone="muted">• {u}</Text>
      ))}
      {storeSafe && appleIapAvailable ? (
        <Button title={v.plan === "pro" ? "Joyo Pro and your subscription" : "Get Joyo Pro"} icon="sparkles-outline" variant={v.plan === "pro" ? "secondary" : "primary"} small onPress={() => router.push("/joyo-pro")} />
      ) : null}
      {v.manage ? <Button title={v.manage.label} icon="open-outline" variant={v.plan === "pro" ? "secondary" : "primary"} small onPress={() => void Linking.openURL(v.manage!.url)} /> : null}
    </Card>
  );
}
