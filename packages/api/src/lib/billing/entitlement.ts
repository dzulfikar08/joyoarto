// Which plan a household is on right now. Pure: the service reads the rows, this decides.
//
// Order: billing off (self-host) > owner allow-list > a live paid entitlement > grandfathered > trial > Free.

import type { BillingInterval, BillingProvider, EntitlementStatus } from "@baroka/db/schema/billing";

import type { BillingConfig } from "./config";
import type { Plan } from "./plans";

const DAY_MS = 86_400_000;
/** A failed renewal (past_due) keeps Pro this long after the period end while the provider retries the card. */
export const PAST_DUE_GRACE_MS = 7 * DAY_MS;

export type EntitlementRow = {
  provider: BillingProvider;
  status: EntitlementStatus;
  interval: BillingInterval | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type EntitlementSource = "selfhost" | "grant" | "subscription" | "grandfather" | "trial" | "free";

export type Entitlement = {
  plan: Plan;
  source: EntitlementSource;
  /** trialing covers the trial and grandfathered Pro; free = never paid, or it ran out. */
  status: EntitlementStatus | "trialing" | "free";
  provider: BillingProvider | null;
  interval: BillingInterval | null;
  /** When Pro ends (renews, for an active subscription); null = no end (self-host, grant) or Free. */
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/** A paid entitlement that grants Pro at `now`. */
export function isLive(row: EntitlementRow, now: Date): boolean {
  if (!row.periodEnd) return false;
  const end = row.periodEnd.getTime();
  if (row.status === "active" || row.status === "canceled") return end > now.getTime();
  if (row.status === "past_due") return end + PAST_DUE_GRACE_MS > now.getTime();
  return false;
}

export function resolveEntitlement(input: {
  config: Pick<BillingConfig, "enforced" | "trialDays" | "grandfather">;
  rows: EntitlementRow[];
  householdCreatedAt: Date;
  /** A member's email is on PRO_EMAILS / ADMIN_EMAILS. */
  granted: boolean;
  now?: Date;
}): Entitlement {
  const now = input.now ?? new Date();
  const base = { provider: null, interval: null, cancelAtPeriodEnd: false } as const;
  if (!input.config.enforced) return { ...base, plan: "pro", source: "selfhost", status: "active", periodEnd: null };
  if (input.granted) return { ...base, plan: "pro", source: "grant", status: "active", periodEnd: null };

  const live = input.rows.filter((r) => isLive(r, now)).sort((a, b) => b.periodEnd!.getTime() - a.periodEnd!.getTime());
  // A renewing subscription beats prepaid time that happens to end later: it is what the member manages.
  const pick = live.find((r) => r.status === "active" && r.provider !== "doku" && r.provider !== "manual") ?? live[0];
  if (pick) {
    return {
      plan: "pro",
      source: "subscription",
      status: pick.status,
      provider: pick.provider,
      interval: pick.interval,
      periodEnd: pick.periodEnd,
      cancelAtPeriodEnd: pick.cancelAtPeriodEnd || pick.status === "canceled",
    };
  }

  const free = freeTimeEnd(input.config, input.householdCreatedAt);
  if (free && free.end.getTime() > now.getTime()) return { ...base, plan: "pro", source: free.source, status: "trialing", periodEnd: free.end };

  // Free. Show why when a subscription lapsed (expired, canceled, past_due beyond grace).
  const last = [...input.rows].sort((a, b) => (b.periodEnd?.getTime() ?? 0) - (a.periodEnd?.getTime() ?? 0))[0];
  if (last) return { plan: "free", source: "free", status: last.status === "active" ? "expired" : last.status, provider: last.provider, interval: last.interval, periodEnd: last.periodEnd, cancelAtPeriodEnd: false };
  return { ...base, plan: "free", source: "free", status: "free", periodEnd: null };
}

/** End of the household's free Pro time: grandfathered (existing households) or the trial, whichever is later. */
export function freeTimeEnd(config: Pick<BillingConfig, "trialDays" | "grandfather">, householdCreatedAt: Date): { end: Date; source: "grandfather" | "trial" } | null {
  const gf = config.grandfather && householdCreatedAt.getTime() < config.grandfather.createdBefore.getTime() ? config.grandfather.until : null;
  const trial = config.trialDays > 0 ? new Date(householdCreatedAt.getTime() + config.trialDays * DAY_MS) : null;
  if (gf && (!trial || gf.getTime() >= trial.getTime())) return { end: gf, source: "grandfather" };
  if (trial) return { end: trial, source: "trial" };
  return null;
}

/** Same day N months later, clamped to the month's end (31 Jan + 1 = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const target = date.getUTCMonth() + months;
  const y = date.getUTCFullYear() + Math.floor(target / 12);
  const m = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = new Date(date);
  out.setUTCDate(1);
  out.setUTCFullYear(y, m, Math.min(date.getUTCDate(), lastDay));
  return out;
}

/** Prepaid months stack on time the household already has (paid, trial or grandfathered), or start now. */
export function nextPeriodEnd(current: Date | null, now: Date, months: number): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addMonths(base, months);
}

/** WIB calendar month of an instant, "YYYY-MM" (usage counters). */
export function wibMonth(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
}
