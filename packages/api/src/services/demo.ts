// The demo account for store reviewers and screenshots (lib/demo.ts has the ids and the restrictions).
//
// - `seedDemo` creates or resets it: the fixed demo user, and its household rebuilt from scratch with made-up data
//   (Jago pockets, a GoPay wallet, about three months of categorized spending at public brands, pending quick adds,
//   budgets, rules and a saved plan scenario). The same WIB day always gives the same data, so running it twice
//   changes nothing; it only ever touches the demo household (and strays only the demo user belongs to).
// - `demoLogin` checks DEMO_LOGIN_CODE (unset = demo login off) and resets the data. The web app then gets a session
//   (packages/auth's /sign-in/demo); the phone app gets a `brk_` token that lasts DEMO_TOKEN_DAYS.
// - The Worker's daily cron calls `seedDemo` too, so writes never outlive a day.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, count, eq, lt, ne, sql } from "drizzle-orm";

import type { Principal } from "../context";
import { chunk, rowsPerInsert } from "../lib/d1";
import {
  DEMO_EMAIL,
  DEMO_HOUSEHOLD_ID,
  DEMO_HOUSEHOLD_NAME,
  DEMO_NAME,
  DEMO_TOKEN_DAYS,
  DEMO_USER_ID,
  demoCodeMatches,
} from "../lib/demo";
import { seedCategories } from "../lib/household";
import { purgeHousehold } from "./account";
import { saveScenario, saveScenarioInput } from "./scenarios";
import { createToken } from "./tokens";

const hm = schema.householdMember;
const t = schema.transaction;

const DAY_MS = 86_400_000;
const WIB_MS = 7 * 3_600_000;
/** Rupiah to minor units (IDR has 2 decimals). */
const rp = (rupiah: number) => Math.round(rupiah) * 100;

/** YYYY-MM-DD in WIB. */
export function wibDate(at: Date): string {
  return new Date(at.getTime() + WIB_MS).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Small deterministic PRNG (mulberry32), seeded from a string, so a given day always builds the same ledger. */
function prng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------ the made-up ledger

type AccountKey = "main" | "belanja" | "darurat" | "liburan" | "gopay";

const ACCOUNTS: { key: AccountKey; name: string; institution: string; type: "bank" | "ewallet"; last4: string | null; opening: number }[] = [
  { key: "main", name: "Jago · Main Pocket", institution: "jago", type: "bank", last4: "1001", opening: rp(6_500_000) },
  { key: "belanja", name: "Jago · Belanja Harian", institution: "jago", type: "bank", last4: "1002", opening: rp(1_200_000) },
  { key: "darurat", name: "Jago · Dana Darurat", institution: "jago", type: "bank", last4: "1003", opening: rp(42_000_000) },
  { key: "liburan", name: "Jago · Liburan", institution: "jago", type: "bank", last4: "1004", opening: rp(4_500_000) },
  { key: "gopay", name: "GoPay wallet", institution: "gopay", type: "ewallet", last4: null, opening: rp(150_000) },
];

/** A row before ids: account, day, signed rupiah, the bank's text, the clean merchant, a category slug (null = uncategorized). */
export type DemoRow = {
  account: AccountKey;
  date: string;
  amount: number;
  description: string;
  merchant: string | null;
  category: string | null;
  status?: "posted" | "pending";
  capturedVia?: "manual" | "notification" | "voice";
  clientRef?: string;
  note?: string;
};

/**
 * Everyday spending at public brands: [merchant, bank text, category, account, min, max rupiah, chance per day]. Coffee,
 * dining, delivery, ride-hailing and small Indomaret/Alfamart baskets are frequent enough for "Where to save" on /plan.
 */
const DAILY: [string, string, string, AccountKey, number, number, number][] = [
  ["Kopi Kenangan", "Gopay - Generic", "food/coffee", "gopay", 22_000, 48_000, 0.4],
  ["Janji Jiwa", "QRIS JANJI JIWA", "food/coffee", "belanja", 18_000, 35_000, 0.15],
  ["Solaria", "QRIS SOLARIA", "food/dining", "belanja", 55_000, 160_000, 0.3],
  ["Gojek", "Gopay - Generic", "transport/ride-hailing", "gopay", 14_000, 42_000, 0.45],
  ["GoFood", "Gopay - Generic", "food/delivery", "gopay", 38_000, 95_000, 0.25],
  ["Indomaret", "QRIS INDOMARET", "food/groceries", "belanja", 18_000, 165_000, 0.35],
  ["Alfamart", "QRIS ALFAMART", "food/groceries", "belanja", 15_000, 120_000, 0.2],
  ["Pertamina", "QRIS PERTAMINA", "transport/fuel", "belanja", 100_000, 250_000, 0.12],
  ["Tokopedia", "TOKOPEDIA", "shopping/online", "main", 45_000, 380_000, 0.06],
  ["Shopee", "SHOPEE", "shopping/online", "main", 35_000, 290_000, 0.07],
];

/** Builds every row from `start` to `today` (inclusive). Pure; balances never go below zero. */
export function demoRows(today: string, start = monthsBack(today, 3)): DemoRow[] {
  const rand = prng(`joyoarto-demo:${today}`);
  const between = (min: number, max: number) => Math.round((min + rand() * (max - min)) / 500) * 500;
  const rows: DemoRow[] = [];
  const balance: Record<AccountKey, number> = Object.fromEntries(ACCOUNTS.map((a) => [a.key, a.opening / 100])) as Record<AccountKey, number>;
  const add = (r: DemoRow) => {
    rows.push(r);
    balance[r.account] += r.amount;
  };
  /** Moves money between own accounts: two rows, both in the transfer category. */
  const move = (date: string, from: AccountKey, to: AccountKey, amount: number, category: string, outText: string, inText: string) => {
    add({ account: from, date, amount: -amount, description: outText, merchant: null, category });
    add({ account: to, date, amount, description: inText, merchant: null, category });
  };

  for (let day = start; day <= today; day = addDays(day, 1)) {
    const dom = Number(day.slice(8, 10));
    const ym = day.slice(0, 7);
    // Monthly: salary, bills, saving into the pockets.
    if (dom === 1) add({ account: "main", date: day, amount: -between(320_000, 410_000), description: "PLN POSTPAID", merchant: "PLN", category: "bills/electricity" });
    if (dom === 2) add({ account: "main", date: day, amount: -330_000, description: "TELKOMSEL HALO", merchant: "Telkomsel", category: "bills/phone-internet" });
    if (dom === 5) add({ account: "main", date: day, amount: -150_000, description: "BPJS KESEHATAN", merchant: "BPJS Kesehatan", category: "bills/insurance" });
    if (dom === 8) add({ account: "main", date: day, amount: -54_990, description: "SPOTIFY", merchant: "Spotify", category: "subscriptions" });
    if (dom === 10) add({ account: "main", date: day, amount: -2_750_000, description: "TRANSFER SEWA RUMAH", merchant: "Sewa rumah", category: "home" });
    if (dom === 15) add({ account: "main", date: day, amount: -95_000, description: "PDAM", merchant: "PDAM", category: "bills/water" });
    if (dom === 25) add({ account: "main", date: day, amount: 15_000_000, description: "GAJI BULANAN", merchant: "Gaji", category: "income/salary" });
    if (dom === 26) {
      move(day, "main", "darurat", 1_500_000, "transfer/savings", "Pindah ke Dana Darurat", "Dari Main Pocket");
      move(day, "main", "liburan", 750_000, "transfer/savings", "Pindah ke Liburan", "Dari Main Pocket");
      move(day, "main", "belanja", 3_000_000, "transfer", "Pindah ke Belanja Harian", "Dari Main Pocket");
    }
    if (dom === 28) add({ account: "darurat", date: day, amount: Math.round(balance.darurat * 0.0025), description: "Bunga", merchant: "Bank Jago", category: "income/interest" });
    if (dom === 20 && ym.endsWith("-09")) add({ account: "main", date: day, amount: -1_250_000, description: "MITRA10", merchant: "Mitra10", category: null });

    for (const [merchant, text, category, account, min, max, chance] of DAILY) {
      if (rand() >= chance) continue;
      const amount = between(min, max);
      if (account === "gopay" && balance.gopay < amount + 20_000) move(day, "main", "gopay", 300_000, "transfer/topup", "TOP UP GOPAY", "Isi saldo dari Jago");
      if (account === "belanja" && balance.belanja < amount + 50_000) move(day, "main", "belanja", 1_000_000, "transfer", "Pindah ke Belanja Harian", "Dari Main Pocket");
      add({ account, date: day, amount: -amount, description: text, merchant, category });
    }
    // One refund and an uncategorized transfer, so those screens are not empty.
    if (dom === 12 && rows.some((r) => r.merchant === "Shopee" && r.date.startsWith(ym))) {
      add({ account: "main", date: day, amount: 89_000, description: "SHOPEE REFUND", merchant: "Shopee", category: "income/refund" });
    }
    if (dom === 18) add({ account: "main", date: day, amount: -500_000, description: "TRANSFER KE REKENING LAIN", merchant: null, category: null });
  }

  // Quick adds the next statement will confirm: from a notification, typed, and spoken.
  add({ account: "gopay", date: today, amount: -32_000, description: "Kopi Kenangan", merchant: "Kopi Kenangan", category: "food/coffee", status: "pending", capturedVia: "notification", clientRef: "demo:pending:1" });
  add({ account: "belanja", date: today, amount: -76_500, description: "Indomaret", merchant: "Indomaret", category: "food/groceries", status: "pending", capturedVia: "manual", clientRef: "demo:pending:2" });
  add({ account: "gopay", date: addDays(today, -1), amount: -24_000, description: "gojek ke kantor", merchant: "Gojek", category: "transport/ride-hailing", status: "pending", capturedVia: "voice", clientRef: "demo:pending:3", note: "Dicatat lewat suara" });
  return rows;
}

/** First day of the month `n` months before `today`'s month. */
function monthsBack(today: string, n: number): string {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------------------------------------ seeding

const principal = (): Principal => ({ userId: DEMO_USER_ID, householdId: DEMO_HOUSEHOLD_ID, scopes: ["finance:read", "finance:write"], via: "session" });

/** Purges every household the demo user is in where nobody else is (the demo household, and strays). */
async function clearDemoHouseholds(db: Database) {
  const mine = await db.select({ householdId: hm.householdId }).from(hm).where(eq(hm.userId, DEMO_USER_ID));
  for (const id of new Set([DEMO_HOUSEHOLD_ID, ...mine.map((m) => m.householdId)])) {
    const [others] = await db
      .select({ n: count() })
      .from(hm)
      .where(and(eq(hm.householdId, id), ne(hm.userId, DEMO_USER_ID)));
    if ((others?.n ?? 0) > 0) {
      // A real person is in it (the API never lets that happen): leave their household alone, just step out.
      await db.delete(hm).where(and(eq(hm.householdId, id), eq(hm.userId, DEMO_USER_ID)));
      continue;
    }
    await purgeHousehold(db, id);
  }
}

/**
 * Creates or resets the demo: the user (kept, with its sessions and tokens) and a freshly rebuilt household. Never
 * touches a household that has a member other than the demo user. AI connections to the demo (reviewers of Claude's
 * connectors directory) older than DEMO_TOKEN_DAYS are removed, as the MCP endpoint refuses them by then anyway.
 */
export async function seedDemo(db: Database, now = new Date()): Promise<{ householdId: string; accounts: number; transactions: number; pending: number }> {
  const today = wibDate(now);
  await db
    .insert(schema.user)
    .values({ id: DEMO_USER_ID, name: DEMO_NAME, email: DEMO_EMAIL, emailVerified: true })
    .onConflictDoUpdate({ target: schema.user.id, set: { name: DEMO_NAME, email: DEMO_EMAIL, image: null } });

  await pruneDemoConnections(db, now);

  const fresh = [
    db.insert(schema.household).values({ id: DEMO_HOUSEHOLD_ID, name: DEMO_HOUSEHOLD_NAME }),
    db.insert(hm).values({ householdId: DEMO_HOUSEHOLD_ID, userId: DEMO_USER_ID, role: "owner", isDefault: true }),
  ] as const;
  await clearDemoHouseholds(db);
  try {
    await db.batch(fresh);
  } catch {
    // A request of the demo user landed between the purge and the insert and got itself a personal household.
    await clearDemoHouseholds(db);
    await db.batch(fresh);
  }
  await seedCategories(db, DEMO_HOUSEHOLD_ID);
  const cats = await db.select({ id: schema.category.id, slug: schema.category.slug }).from(schema.category).where(eq(schema.category.householdId, DEMO_HOUSEHOLD_ID));
  const catId = new Map(cats.map((c) => [c.slug, c.id]));

  const accountId = new Map<AccountKey, string>();
  const created = new Date(now.getTime() - 120 * DAY_MS);
  await db.insert(schema.finAccount).values(
    ACCOUNTS.map((a, i) => {
      const id = `demo-${a.key}`;
      accountId.set(a.key, id);
      // createdAt spaced out, so the accounts list keeps this order.
      return { id, householdId: DEMO_HOUSEHOLD_ID, name: a.name, institution: a.institution, type: a.type, currency: "IDR", last4: a.last4, openingBalance: a.opening, createdAt: new Date(created.getTime() + i * 1000) };
    }),
  );

  const rows = demoRows(today);
  const values = rows.map((r, i) => ({
    id: crypto.randomUUID(),
    householdId: DEMO_HOUSEHOLD_ID,
    accountId: accountId.get(r.account)!,
    date: r.date,
    amount: rp(r.amount),
    currency: "IDR",
    description: r.description,
    merchant: r.merchant,
    note: r.note ?? null,
    categoryId: r.category ? (catId.get(r.category) ?? null) : null,
    categorySource: r.category ? ("manual" as const) : null,
    dedupeKey: `demo:${i}`,
    status: r.status ?? ("posted" as const),
    capturedVia: r.capturedVia ?? null,
    capturedAt: r.status === "pending" ? now : null,
    clientRef: r.clientRef ?? null,
    createdBy: DEMO_USER_ID,
  }));
  for (const part of chunk(values, rowsPerInsert(20))) await db.insert(t).values(part);

  await db.insert(schema.rule).values([
    { id: crypto.randomUUID(), householdId: DEMO_HOUSEHOLD_ID, priority: 100, field: "merchant", match: "contains", pattern: "kopi kenangan", setCategoryId: catId.get("food/coffee")! },
    { id: crypto.randomUUID(), householdId: DEMO_HOUSEHOLD_ID, priority: 100, field: "description", match: "contains", pattern: "pln", direction: "out", setCategoryId: catId.get("bills/electricity")!, setMerchant: "PLN" },
  ]);
  await db.insert(schema.budget).values([
    { id: crypto.randomUUID(), householdId: DEMO_HOUSEHOLD_ID, categoryId: catId.get("food")!, amount: rp(3_500_000) },
    { id: crypto.randomUUID(), householdId: DEMO_HOUSEHOLD_ID, categoryId: catId.get("transport")!, amount: rp(1_200_000) },
    { id: crypto.randomUUID(), householdId: DEMO_HOUSEHOLD_ID, categoryId: catId.get("shopping")!, amount: rp(750_000) },
  ]);

  await saveScenario(
    db,
    principal(),
    saveScenarioInput.parse({
      name: "Mobil listrik + bayi",
      plan: {
        items: [
          { type: "loan", label: "Mobil listrik", price: rp(250_000_000), downPaymentPct: 30, tenorMonths: 48, ratePct: 3.5, rateType: "flat", fuelMonthly: rp(300_000), maintenanceMonthly: rp(150_000), savesMonthly: rp(400_000) },
          { type: "recurring", label: "Kebutuhan bayi", monthly: rp(1_500_000), annualIncreasePct: 5 },
          { type: "oneOff", label: "Persalinan", amount: rp(15_000_000), fundedFrom: "emergency" },
        ],
      },
    }),
  );

  const pending = rows.filter((r) => r.status === "pending").length;
  return { householdId: DEMO_HOUSEHOLD_ID, accounts: ACCOUNTS.length, transactions: rows.length, pending };
}

/** Drops the demo user's AI connections (consents and refresh tokens) last approved over DEMO_TOKEN_DAYS ago. */
export async function pruneDemoConnections(db: Database, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - DEMO_TOKEN_DAYS * DAY_MS);
  const c = schema.oauthConsent;
  const r = schema.oauthRefreshToken;
  await db.batch([
    db.delete(c).where(and(eq(c.userId, DEMO_USER_ID), lt(sql`coalesce(${c.updatedAt}, ${c.createdAt})`, cutoff.getTime()))),
    db.delete(r).where(and(eq(r.userId, DEMO_USER_ID), lt(r.createdAt, cutoff))),
  ]);
}

// ------------------------------------------------------------------------------------------------ signing in

/** Checks the code (refused when DEMO_LOGIN_CODE is unset) and resets the demo data. Returns the demo user's id. */
export async function demoLogin(db: Database, code: string, expected: string | null | undefined, now = new Date()): Promise<{ userId: string }> {
  if (!expected?.trim()) throw new ORPCError("NOT_FOUND", { message: "Demo login is not available on this server." });
  if (!(await demoCodeMatches(code, expected))) throw new ORPCError("UNAUTHORIZED", { message: "That demo code is not right." });
  await seedDemo(db, now);
  return { userId: DEMO_USER_ID };
}

/** For the phone app: a demo login that answers with a `brk_` token for the demo user (DEMO_TOKEN_DAYS). */
export async function demoToken(db: Database, code: string, expected: string | null | undefined, now = new Date()) {
  await demoLogin(db, code, expected, now);
  // Expired demo tokens are dropped, so the table does not grow with every review.
  await db.delete(schema.apiToken).where(and(eq(schema.apiToken.userId, DEMO_USER_ID), lt(schema.apiToken.expiresAt, now)));
  const token = await createToken(db, principal(), { name: "Demo (phone app)", scopes: ["finance:read", "finance:write"], expiresInDays: DEMO_TOKEN_DAYS });
  return { token: token.token, expiresAt: token.expiresAt, household: DEMO_HOUSEHOLD_NAME, note: "Demo account: the data is made up and resets every day." };
}
