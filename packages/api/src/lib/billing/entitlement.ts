// Which plan a user is on right now. Pure: the service reads the user and JoyoRogo's answer, this decides.
//
// Joyo Pro is per ACCOUNT: every limit follows the acting user's plan; a household has no plan of its own.
// Order: billing off (self-host) > owner allow-list > grandfathered / trial (local, no call needed) > Joyo Pro from
// JoyoRogo > Free. When both local free time and Joyo Pro apply, Joyo Pro is shown: it is what the user manages.

import type { BillingConfig } from "./config";
import type { Plan } from "./plans";

const DAY_MS = 86_400_000;

export type EntitlementSource = "selfhost" | "grant" | "joyo" | "grandfather" | "trial" | "free";

export type Entitlement = {
  plan: Plan;
  source: EntitlementSource;
  /** When Pro ends (renews, for a subscription); null = no end (self-host, grant, lifetime) or Free. */
  until: Date | null;
};

/** End of the user's free Pro time: grandfathered (accounts from before billing) or the trial, whichever is later. */
export function freeTimeEnd(config: Pick<BillingConfig, "trialDays" | "grandfather">, userCreatedAt: Date): { end: Date; source: "grandfather" | "trial" } | null {
  const gf = config.grandfather && userCreatedAt.getTime() < config.grandfather.createdBefore.getTime() ? config.grandfather.until : null;
  const trial = config.trialDays > 0 ? new Date(userCreatedAt.getTime() + config.trialDays * DAY_MS) : null;
  if (gf && (!trial || gf.getTime() >= trial.getTime())) return { end: gf, source: "grandfather" };
  if (trial) return { end: trial, source: "trial" };
  return null;
}

/** Plan without asking JoyoRogo: null means "ask it" (only Joyo Pro can still make this user Pro). */
export function localEntitlement(input: {
  config: Pick<BillingConfig, "enforced" | "trialDays" | "grandfather" | "proEmails">;
  email: string;
  userCreatedAt: Date;
  now: Date;
}): Entitlement | null {
  if (!input.config.enforced) return { plan: "pro", source: "selfhost", until: null };
  if (input.config.proEmails.includes(input.email.trim().toLowerCase())) return { plan: "pro", source: "grant", until: null };
  const free = freeTimeEnd(input.config, input.userCreatedAt);
  if (free && free.end.getTime() > input.now.getTime()) return { plan: "pro", source: free.source, until: free.end };
  return null;
}

/** Final plan: local Pro (grant, grandfathered, trial), else Joyo Pro, else Free. */
export function resolveEntitlement(local: Entitlement | null, joyo: { pro: boolean; until: Date | null } | null): Entitlement {
  if (local && (local.source === "selfhost" || local.source === "grant")) return local;
  if (joyo?.pro) return { plan: "pro", source: "joyo", until: joyo.until };
  return local ?? { plan: "free", source: "free", until: null };
}

/** WIB calendar month of an instant, "YYYY-MM" (usage counters). */
export function wibMonth(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
}
