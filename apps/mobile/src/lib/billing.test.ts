import { expect, test } from "bun:test";

import { billingView, importsLeft, planLine, proOnlyNote, type BillingStatus } from "./billing";

const status = (p: Partial<BillingStatus> = {}): BillingStatus =>
  ({
    enforced: true,
    plan: "free",
    entitlement: { plan: "free", source: null, until: null },
    joyo: { pro: false, until: null, plan: null, source: null, checkedAt: null, stale: false },
    proUrl: "https://joyorogo.example/pro?from=joyoarto",
    limits: { statementImportsPerMonth: 2, members: 2, aiDailyCap: 5, emailImport: false, mcpConnector: false, bulkImport: false },
    usage: { statementImports: { used: 1, limit: 2, period: "2026-11" }, members: { used: 1, limit: 2 } },
    ...p,
  }) as unknown as BillingStatus;

test("Android links to JoyoRogo", () => {
  const v = billingView(status(), { storeSafe: false })!;
  expect(v.manage).toEqual({ label: "Get Joyo Pro in JoyoRogo", url: "https://joyorogo.example/pro?from=joyoarto" });
  expect(v.usage).toEqual(["Statement imports this month: 1 of 2", "Members (invites included): 1 of 2", "Joyo AI: 5 questions a day"]);
  expect(v.notes.join(" ")).toMatch(/Buy and manage it in JoyoRogo/);
  const pro = billingView(status({ plan: "pro", joyo: { pro: true, until: "2027-01-01T00:00:00Z", plan: "yearly", source: "play", checkedAt: null, stale: false } } as unknown as Partial<BillingStatus>), { storeSafe: false })!;
  expect(pro.manage?.label).toBe("Manage in JoyoRogo");
  expect(pro.usage).toEqual([]);
});

test("iOS (store-safe) shows status only: no link, no purchase wording, no prices", () => {
  const s = status({
    plan: "pro",
    entitlement: { plan: "pro", source: "trial", until: "2026-11-18T00:00:00Z" },
    joyo: { pro: true, until: "2027-01-01T00:00:00Z", plan: "yearly", source: "play", checkedAt: null, stale: true },
  } as unknown as Partial<BillingStatus>);
  const v = billingView(s, { storeSafe: true })!;
  expect(v.manage).toBeNull();
  const all = [v.line, ...v.notes, ...v.usage].join(" ");
  expect(all).not.toMatch(/JoyoRogo|buy|purchase|price|Rp/i);
  expect(v.line).toBe("Pro trial until 18 Nov 2026.");
  expect(v.notes).toEqual(["Your Joyo Pro is active until 1 Jan 2027.", "The status above is from the last check."]);
  expect(proOnlyNote("Email import", { storeSafe: true })).not.toMatch(/JoyoRogo|Pro/);
  expect(proOnlyNote("Email import", { storeSafe: false })).toMatch(/JoyoRogo/);
});

test("self-hosted: nothing to show", () => {
  expect(billingView(status({ proUrl: null }), { storeSafe: false })).toBeNull();
});

test("plan lines and imports left", () => {
  expect(planLine({ entitlement: { plan: "pro", source: "joyo", until: "2026-12-01T00:00:00Z" }, joyo: { plan: "monthly" } } as never)).toBe("Joyo Pro monthly, active until 1 Dec 2026.");
  expect(planLine({ entitlement: { plan: "pro", source: "selfhost", until: null }, joyo: null } as never)).toMatch(/no limits/);
  expect(planLine({ entitlement: { plan: "free", source: null, until: null }, joyo: null } as never)).toBe("Free.");
  expect(importsLeft(status())).toBe(1);
  expect(importsLeft(status({ usage: { statementImports: { used: 5, limit: 2, period: "x" }, members: { used: 1, limit: 2 } } } as unknown as Partial<BillingStatus>))).toBe(0);
  expect(importsLeft(undefined)).toBeNull();
});
