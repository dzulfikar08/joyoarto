// Joyo Pro status on the phone (web: apps/web/src/routes/-billing.tsx). On Android Joyo Pro is bought and managed in
// JoyoRogo ("Manage in JoyoRogo", opens the browser). iOS (`storeSafe`, App Review 3.1.1 / 3.1.3) sells it with
// In-App Purchase on its own screen (app/joyo-pro.tsx) and never links outside the app. Pure, unit-tested.

import { shortDate } from "./format";
import type { AppRouterClient, Out } from "./rpc";

export type BillingStatus = Out<AppRouterClient["billing"]["status"]>;

const PLAN_NAME: Record<string, string> = { monthly: "monthly", yearly: "yearly", lifetime: "lifetime" };

/** One line on what the account has now. */
export function planLine(s: Pick<BillingStatus, "entitlement" | "joyo">): string {
  const e = s.entitlement;
  const until = e.until ? shortDate(e.until) : "";
  switch (e.source) {
    case "selfhost":
      return "This server has no limits: every feature is on.";
    case "grant":
      return "Pro, granted by the operator.";
    case "joyo": {
      const kind = s.joyo?.plan && PLAN_NAME[s.joyo.plan] ? ` ${PLAN_NAME[s.joyo.plan]}` : "";
      return until ? `Joyo Pro${kind}, active until ${until}.` : `Joyo Pro${kind}.`;
    }
    case "grandfather":
      return `Free Pro for early users, until ${until}.`;
    case "trial":
      return `Pro trial until ${until}.`;
    default:
      return "Free.";
  }
}

export type BillingView = {
  plan: "free" | "pro";
  line: string;
  /** Extra status lines (Joyo Pro behind a longer trial, JoyoRogo unreachable). */
  notes: string[];
  /** Free-plan usage against the limits. */
  usage: string[];
  /** Android only: the button to JoyoRogo, where Joyo Pro is bought and managed. */
  manage: { label: string; url: string } | null;
};

/** What the Billing card shows; null when billing is off on this server (self-hosted: nothing to show). */
export function billingView(s: BillingStatus, opts: { storeSafe: boolean }): BillingView | null {
  if (!s.proUrl) return null;
  const joyo = s.joyo;
  const notes: string[] = [];
  // Joyo Pro bought in JoyoRogo but not the reason this account is Pro now (a trial or early-user Pro runs longer).
  if (joyo?.pro && s.entitlement.source !== "joyo") {
    const where = opts.storeSafe ? "Your Joyo Pro" : "Your Joyo Pro in JoyoRogo";
    notes.push(joyo.until ? `${where} is active until ${shortDate(joyo.until)}.` : `${where} is active.`);
  }
  if (joyo?.stale) notes.push(opts.storeSafe ? "The status above is from the last check." : "JoyoRogo can't be reached right now; the status above is from the last check.");
  if (!opts.storeSafe) {
    notes.push(
      "Joyo Pro is one subscription per account, valid in JoyoArto, JoyoRogo and JoyoFit. Buy and manage it in JoyoRogo with the same Google account; it shows up here within minutes. Other household members have their own plan.",
    );
  }
  const usage: string[] = [];
  if (s.plan === "free") {
    const imports = s.usage.statementImports;
    if (imports.limit !== null) usage.push(`Statement imports this month: ${imports.used} of ${imports.limit}`);
    usage.push(`Members (invites included): ${s.usage.members.used} of ${s.usage.members.limit}`);
    if (s.limits.aiDailyCap !== null) usage.push(`Joyo AI: ${s.limits.aiDailyCap} questions a day`);
  }
  return {
    plan: s.plan,
    line: planLine(s),
    notes,
    usage,
    manage: opts.storeSafe ? null : { label: joyo?.pro ? "Manage in JoyoRogo" : "Get Joyo Pro in JoyoRogo", url: s.proUrl },
  };
}

/** Statement imports left this month on Free; null = unlimited (or unknown). */
export function importsLeft(s: Pick<BillingStatus, "usage"> | undefined): number | null {
  const u = s?.usage.statementImports;
  return u && u.limit !== null ? Math.max(0, u.limit - u.used) : null;
}

/**
 * A Pro-only feature that is off for this account: what to say instead of the control. iOS points to its own Joyo Pro
 * screen (In-App Purchase), never to JoyoRogo or the web.
 */
export function proOnlyNote(feature: string, opts: { storeSafe: boolean }): string {
  return opts.storeSafe ? `${feature} is part of Joyo Pro (More → Joyo Pro).` : `${feature} is part of Joyo Pro. Get it in JoyoRogo with the same Google account.`;
}
