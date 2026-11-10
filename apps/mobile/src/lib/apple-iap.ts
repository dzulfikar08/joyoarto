// Joyo Pro on iOS: In-App Purchase of JoyoArto's own App Store products (App Review 3.1.1). StoreKit 2 through the local
// module (modules/apple-iap, same as JoyoRogo's); the server hands the signed transaction to JoyoRogo, the only billing
// authority, which credits the person's Joyo Pro (packages/api services/billing.ts, JoyoRogo docs/joyo-pro.md).
//
// A transaction stays unfinished until the server has credited it, so an interrupted purchase is replayed at the next
// launch; one the server refuses for good (bad receipt, another account's subscription) is finished so it doesn't loop.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Alert, Linking, Platform } from "react-native";

import { appleIap } from "@/modules/apple-iap";
import { client } from "@/src/lib/orpc";
import { queryClient } from "@/src/lib/query";

export const APPLE_PRODUCT_IDS = {
  monthly: "com.joyodigitama.joyoarto.pro.monthly",
  yearly: "com.joyodigitama.joyoarto.pro.yearly",
} as const;
export type ApplePlan = keyof typeof APPLE_PRODUCT_IDS;

export const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";
/** Apple's standard licence agreement: the Terms of Use of an auto-renewable subscription (3.1.2). */
export const APPLE_EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

/** In-App Purchase can run here (an iOS build with the native module). */
export const appleIapAvailable = Platform.OS === "ios" && appleIap !== null;

/** The server will never credit this transaction: finish it instead of replaying it forever. */
function isDefinitive(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "BAD_REQUEST";
}

async function redeem(signedTransaction: string) {
  return client.billing.appleRedeem({ signedTransaction });
}

/** StoreKit products for both plans (localized price); a plan is null while its product is unavailable. */
export function useAppleProducts() {
  return useQuery({
    queryKey: ["apple-pro-products"],
    queryFn: async () => {
      const [monthly, yearly] = await Promise.all([appleIap?.getProduct(APPLE_PRODUCT_IDS.monthly), appleIap?.getProduct(APPLE_PRODUCT_IDS.yearly)]);
      return { monthly: monthly ?? null, yearly: yearly ?? null };
    },
    enabled: appleIapAvailable,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

/** Buys a plan: StoreKit sheet, then the server credits it, then the transaction is finished. */
export function useApplePurchase() {
  return useMutation({
    mutationFn: async (plan: ApplePlan): Promise<"cancelled" | "bought" | "sandbox"> => {
      if (!appleIap) throw new Error("In-App Purchase is not available on this device.");
      const { appAccountToken } = await client.billing.appleAccountToken();
      const result = await appleIap.purchase(APPLE_PRODUCT_IDS[plan], appAccountToken ?? "");
      if (result.status === "cancelled") return "cancelled";
      if (result.status === "pending") throw new Error("The purchase is waiting for approval (Ask to Buy or a payment check). Joyo Pro turns on once Apple approves it.");
      let answer: Awaited<ReturnType<typeof redeem>>;
      try {
        answer = await redeem(result.signedTransaction);
      } catch (error) {
        if (isDefinitive(error)) await appleIap.finish(result.transactionId);
        throw error;
      }
      await appleIap.finish(result.transactionId);
      return answer.sandbox ? "sandbox" : "bought";
    },
    onSuccess: (result) => {
      if (result === "cancelled") return;
      void queryClient.invalidateQueries();
      // Apple's Sandbox (TestFlight) charges nothing and JoyoRogo grants 24 hours: say so, so nobody thinks they paid.
      if (result === "sandbox") Alert.alert("Test purchase", "This was Apple's test purchase, so nothing was charged. Joyo Pro is on for 24 hours.");
    },
  });
}

/** Posts every active subscription of this Apple ID; `sync` asks the App Store to refresh first (Restore purchases). */
async function syncEntitlements(sync: boolean): Promise<{ accepted: number; rejected: number }> {
  const summary = { accepted: 0, rejected: 0 };
  if (!appleIap) return summary;
  for (const item of await appleIap.currentEntitlements(sync)) {
    try {
      await redeem(item.signedTransaction);
      summary.accepted++;
    } catch (error) {
      if (!isDefinitive(error)) throw error;
      summary.rejected++;
    }
  }
  return summary;
}

/** "Restore purchases" (required by Apple). */
export function useAppleRestore() {
  return useMutation({
    mutationFn: () => syncEntitlements(true),
    onSuccess: () => void queryClient.invalidateQueries(),
  });
}

/** Apple's subscription management sheet (cancel, change plan), or the App Store page when the sheet can't open. */
export async function openManageSubscriptions(): Promise<void> {
  if (appleIap && (await appleIap.showManageSubscriptions().catch(() => false))) return;
  await Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
}

/**
 * At launch, signed in: credits purchases interrupted before the server confirmed them, then renewals made while the
 * app was closed. Failures stay for the next launch.
 */
export function useAppleReplay(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !appleIap) return;
    let cancelled = false;
    void (async () => {
      for (const item of await appleIap.unfinished()) {
        if (cancelled) return;
        try {
          await redeem(item.signedTransaction);
        } catch (error) {
          if (!isDefinitive(error)) return;
        }
        await appleIap.finish(item.transactionId);
        void queryClient.invalidateQueries();
      }
      if (cancelled) return;
      const summary = await syncEntitlements(false);
      if (summary.accepted > 0) void queryClient.invalidateQueries();
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
