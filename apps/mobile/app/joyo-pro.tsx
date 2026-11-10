// Joyo Pro on iOS (In-App Purchase): what it adds, Apple's prices for both plans, subscribe, restore, manage, and the
// subscription terms App Review asks for (3.1.2: title, length, price, auto-renewal, Terms of Use and Privacy links).
// Android and the web never open this screen: Joyo Pro is bought in JoyoRogo there.

import { useQuery } from "@tanstack/react-query";
import { Linking, View } from "react-native";

import { Button, Card, ErrorState, Pill, Row, Screen, SkeletonCard, Text } from "@/components/ui";
import { APPLE_EULA_URL, appleIapAvailable, openManageSubscriptions, useAppleProducts, useApplePurchase, useAppleRestore, type ApplePlan } from "@/src/lib/apple-iap";
import { planLine } from "@/src/lib/billing";
import { errorMessage } from "@/src/lib/errors";
import { orpc } from "@/src/lib/orpc";
import { toast } from "@/src/lib/toast";

const BENEFITS = [
  "Unlimited bank statement imports, several at once",
  "Import statements by email",
  "Joyo AI without the daily limit of Free",
  "Unlimited receipt scans and claim reports",
  "Save plans and scenarios",
  "Up to 6 people in your household",
  "The Claude connector (MCP)",
  "The same Joyo Pro works in JoyoRogo and JoyoFit",
];

const PERIOD: Record<ApplePlan, { title: string; per: string }> = {
  monthly: { title: "Monthly", per: "month" },
  yearly: { title: "Yearly", per: "year" },
};

export default function JoyoProScreen() {
  const status = useQuery(orpc.billing.status.queryOptions());
  const products = useAppleProducts();
  const buy = useApplePurchase();
  const restore = useAppleRestore();
  const isPro = status.data?.plan === "pro";

  function subscribe(plan: ApplePlan) {
    buy.mutate(plan, {
      onSuccess: (r) => {
        if (r !== "cancelled") toast.success("Joyo Pro is on. Thank you!");
      },
      onError: (e) => toast.error("Couldn't finish the purchase", errorMessage(e)),
    });
  }

  function onRestore() {
    restore.mutate(undefined, {
      onSuccess: (s) => {
        if (s.accepted > 0) toast.success("Purchases restored");
        else if (s.rejected > 0) toast.error("This Apple ID's subscription belongs to another Joyo account");
        else toast.success("No active Joyo Pro subscription on this Apple ID");
      },
      onError: (e) => toast.error("Couldn't restore", errorMessage(e)),
    });
  }

  return (
    <Screen>
      <Card title="Joyo Pro" action={status.data ? <Pill label={isPro ? "Pro" : "Free"} tone={isPro ? "primary" : "muted"} /> : undefined}>
        {status.isPending ? <SkeletonCard lines={1} /> : status.data ? <Text>{planLine(status.data)}</Text> : null}
        <View style={{ gap: 6 }}>
          {BENEFITS.map((b) => (
            <Text key={b} variant="caption">• {b}</Text>
          ))}
        </View>
      </Card>

      {!appleIapAvailable ? (
        <Card>
          <Text tone="muted">In-App Purchase is not available on this device.</Text>
        </Card>
      ) : products.isPending ? (
        <SkeletonCard lines={3} />
      ) : products.isError ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} compact />
      ) : (
        (["yearly", "monthly"] as const).map((plan) => {
          const p = products.data?.[plan];
          return (
            <Card key={plan} title={`Joyo Pro ${PERIOD[plan].title}`} subtitle={p ? `${p.displayPrice} per ${PERIOD[plan].per}, renews automatically` : "Not available right now"}>
              <Button
                title={p ? `Subscribe for ${p.displayPrice} / ${PERIOD[plan].per}` : "Unavailable"}
                variant={plan === "yearly" ? "primary" : "secondary"}
                disabled={!p || buy.isPending}
                loading={buy.isPending && buy.variables === plan}
                onPress={() => subscribe(plan)}
              />
            </Card>
          );
        })
      )}

      {appleIapAvailable ? (
        <Row>
          <Button title="Restore purchases" variant="ghost" small flex loading={restore.isPending} onPress={onRestore} />
          <Button title="Manage subscription" variant="ghost" small flex onPress={() => void openManageSubscriptions()} />
        </Row>
      ) : null}

      <Text variant="caption" tone="muted">
        Payment is charged to your Apple ID when you confirm. The subscription renews automatically at the same price for the same period unless you cancel
        at least 24 hours before the period ends. Manage or cancel it in Settings → your name → Subscriptions. Joyo Pro belongs to your Joyo account, so
        it also works when you sign in on other devices.
      </Text>
      <Row>
        <Button title="Terms of Use" variant="ghost" small flex onPress={() => void Linking.openURL(APPLE_EULA_URL)} />
        <Button title="Privacy Policy" variant="ghost" small flex onPress={() => void Linking.openURL("https://arto.joyorogo.com/privasi")} />
      </Row>
      {status.isError ? <Text variant="caption" tone="destructive">{errorMessage(status.error)}</Text> : null}
    </Screen>
  );
}
