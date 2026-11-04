// End-to-end check of notification capture against a running server, without a phone: every sample notification
// goes through the app's own parser and queue (ingest → quickAddBody → POST /api/transactions/quick), and the saved
// transaction must match what the parser read. Use a local stack with a throwaway household:
//
//   bun scripts/e2e-capture.ts http://localhost:3500 brk_...
//
// It creates a "Jago (e2e)" and "GoPay (e2e)" account and pending transactions in that household.

import { createApi } from "../src/lib/api";
import { applyOutcome, ingest, quickAddBody, type InboxItem } from "../src/capture/queue";
import { SAMPLES } from "../src/capture/parsers/samples";

const [server, token] = process.argv.slice(2);
if (!server || !token) throw new Error("usage: bun scripts/e2e-capture.ts <server> <brk_token>");
const api = createApi({ server, token });

const me = await api.me();
console.log(`household ${me.household.name} (${me.household.id}), user ${me.user.email}, scopes ${me.scopes.join(" ")}`);

async function account(name: string, institution: string, type: string) {
  const existing = (await api.accounts()).find((a) => a.name === name);
  if (existing) return existing.id;
  const res = await fetch(`${server}/api/accounts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, institution, type, currency: "IDR" }),
  });
  if (!res.ok) throw new Error(`create account: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}
const jago = await account("Jago (e2e)", "jago", "bank");
const gopay = await account("GoPay (e2e)", "gopay", "ewallet");

const run = Date.now();
const inbox: InboxItem[] = SAMPLES.map((s, i) => ({
  id: `0|${s.packageName}|${i}|null|10${i}|${run + i * 300_000}`,
  packageName: s.packageName,
  key: `0|${s.packageName}|${i}`,
  postedAt: run + i * 300_000,
  title: s.title,
  text: s.text,
  simulated: true,
}));
const items = ingest([], inbox, { accountBySource: { jago, gopay }, autoSendLowConfidence: true });

let failures = 0;
for (const item of items) {
  const sample = SAMPLES[inbox.findIndex((n) => n.id === item.id)]!;
  if (item.status === "ignored") {
    console.log(`  ignored  ${sample.name}: ${item.ignoredReason}`);
    continue;
  }
  const body = quickAddBody(item)!;
  if (JSON.stringify(body).includes(item.text)) throw new Error("notification text leaked into the request");
  const res = await api.quickAdd(body);
  const again = await api.quickAdd(body);
  const want = (item.parsed!.direction === "in" ? 1 : -1) * item.parsed!.amountMinor;
  const ok = res.created && !again.created && again.transaction.id === res.transaction.id && res.transaction.amount === want && res.transaction.status === "pending" && res.transaction.capturedVia === "notification";
  if (!ok) failures++;
  console.log(`  ${ok ? "ok      " : "MISMATCH"} ${sample.name}: ${res.transaction.display} · ${res.transaction.account} · ${res.transaction.merchant ?? "-"} (${res.transaction.date})${ok ? "" : ` want ${want}, got ${res.transaction.amount}, created=${res.created}/${again.created}`}`);
  applyOutcome(item, { ok: true, transactionId: res.transaction.id, display: res.transaction.display, account: res.transaction.account, category: res.transaction.category }, Date.now());
}

// Fix after sending: category and account on a pending row.
const cats = await api.categories();
const first = (await api.quickAdd(quickAddBody(items.find((i) => i.status !== "ignored")!)!)).transaction;
const fixed = await api.updateTransaction({ id: first.id, category: cats.find((c) => c.kind === "expense")?.slug ?? null, accountId: gopay });
console.log(`  fix after send: ${fixed.account} · ${fixed.category}`);
if (fixed.accountId !== gopay) failures++;

const dash = await api.dashboard();
console.log(`dashboard ${dash.month}: in ${dash.kpis.income.display}, out ${dash.kpis.spending.display}, pending ${dash.attention.pending}`);

const probe = await fetch(`${server}/api/imports/statement-file`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
console.log(`statement-file endpoint: HTTP ${probe.status}${probe.status === 404 ? " (not deployed on this server yet; the app's dev mock covers it)" : ""}`);

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("all good");
