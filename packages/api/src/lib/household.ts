import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, asc, desc, eq } from "drizzle-orm";

import { chunk, rowsPerInsert } from "./d1";

type Seed = { slug: string; name: string; kind: "expense" | "income" | "transfer"; icon?: string };

/** Starter categories. Slugs are stable keys; names can be renamed freely. */
export const DEFAULT_CATEGORIES: Seed[] = [
  { slug: "food", name: "Food & drink", kind: "expense", icon: "utensils" },
  { slug: "food/groceries", name: "Groceries", kind: "expense" },
  { slug: "food/dining", name: "Eating out", kind: "expense" },
  { slug: "food/coffee", name: "Coffee & snacks", kind: "expense" },
  { slug: "food/delivery", name: "Food delivery", kind: "expense" },
  { slug: "transport", name: "Transport", kind: "expense", icon: "car" },
  { slug: "transport/ride-hailing", name: "Ride-hailing", kind: "expense" },
  { slug: "transport/fuel", name: "Fuel", kind: "expense" },
  { slug: "transport/parking-toll", name: "Parking & toll", kind: "expense" },
  { slug: "transport/public", name: "Public transport", kind: "expense" },
  { slug: "shopping", name: "Shopping", kind: "expense", icon: "shopping-bag" },
  { slug: "shopping/online", name: "Online shopping", kind: "expense" },
  { slug: "shopping/clothing", name: "Clothing", kind: "expense" },
  { slug: "shopping/electronics", name: "Electronics", kind: "expense" },
  { slug: "bills", name: "Bills & utilities", kind: "expense", icon: "receipt" },
  { slug: "bills/electricity", name: "Electricity (PLN)", kind: "expense" },
  { slug: "bills/water", name: "Water (PDAM)", kind: "expense" },
  { slug: "bills/phone-internet", name: "Phone & internet", kind: "expense" },
  { slug: "bills/insurance", name: "Insurance & BPJS", kind: "expense" },
  { slug: "subscriptions", name: "Subscriptions", kind: "expense", icon: "repeat" },
  { slug: "home", name: "Home & rent", kind: "expense", icon: "home" },
  { slug: "health", name: "Health", kind: "expense", icon: "heart-pulse" },
  { slug: "education", name: "Education", kind: "expense", icon: "graduation-cap" },
  { slug: "entertainment", name: "Entertainment", kind: "expense", icon: "film" },
  { slug: "travel", name: "Travel", kind: "expense", icon: "plane" },
  { slug: "personal-care", name: "Personal care", kind: "expense" },
  { slug: "family", name: "Family support", kind: "expense", icon: "users" },
  { slug: "giving", name: "Zakat, infaq & sedekah", kind: "expense", icon: "hand-heart" },
  { slug: "fees", name: "Bank fees & admin", kind: "expense" },
  { slug: "tax", name: "Tax", kind: "expense" },
  { slug: "other", name: "Other spending", kind: "expense" },
  { slug: "income/salary", name: "Salary", kind: "income", icon: "briefcase" },
  { slug: "income/business", name: "Business income", kind: "income" },
  { slug: "income/interest", name: "Interest & returns", kind: "income" },
  { slug: "income/refund", name: "Refunds & cashback", kind: "income" },
  { slug: "income/gift", name: "Gifts received", kind: "income" },
  { slug: "income/other", name: "Other income", kind: "income" },
  { slug: "transfer", name: "Transfer between own accounts", kind: "transfer", icon: "arrow-left-right" },
  { slug: "transfer/topup", name: "E-wallet top-up", kind: "transfer" },
  { slug: "transfer/credit-card", name: "Credit card payment", kind: "transfer" },
  { slug: "transfer/cash", name: "Cash withdrawal", kind: "transfer" },
  { slug: "transfer/savings", name: "Savings & investments", kind: "transfer" },
];

/** Parent slug of "food/groceries" is "food"; top-level categories have none. */
export function parentSlug(slug: string): string | null {
  const at = slug.lastIndexOf("/");
  return at > 0 ? slug.slice(0, at) : null;
}

/** Conservative starter rules for lines every Indonesian bank prints; low priority so the user's own rules win. */
export const DEFAULT_RULES: { pattern: string; category: string; direction?: "in" | "out" }[] = [
  { pattern: "tarikan atm", category: "transfer/cash", direction: "out" },
  { pattern: "biaya adm", category: "fees", direction: "out" },
  { pattern: "biaya admin", category: "fees", direction: "out" },
  { pattern: "bunga", category: "income/interest", direction: "in" },
  { pattern: "pajak", category: "tax", direction: "out" },
  { pattern: "top up", category: "transfer/topup", direction: "out" },
  { pattern: "topup", category: "transfer/topup", direction: "out" },
];

export async function seedCategories(db: Database, householdId: string): Promise<void> {
  const ids = new Map(DEFAULT_CATEGORIES.map((c) => [c.slug, crypto.randomUUID()]));
  const rows = DEFAULT_CATEGORIES.map((c) => ({
    id: ids.get(c.slug)!,
    householdId,
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    icon: c.icon ?? null,
    parentId: (parentSlug(c.slug) && ids.get(parentSlug(c.slug)!)) || null,
  }));
  for (const part of chunk(rows, rowsPerInsert(7))) {
    await db.insert(schema.category).values(part).onConflictDoNothing();
  }
  await db.insert(schema.rule).values(
    DEFAULT_RULES.map((r) => ({
      id: crypto.randomUUID(),
      householdId,
      priority: 1000,
      field: "description" as const,
      match: "contains" as const,
      pattern: r.pattern,
      direction: r.direction ?? null,
      setCategoryId: ids.get(r.category)!,
    })),
  );
}

/**
 * The household the user acts in: their default membership (household_member.is_default, one per user). A user
 * without any membership gets a personal household (with the starter categories) on first use.
 */
export async function ensureHousehold(db: Database, userId: string, name?: string): Promise<string> {
  const found = await activeMembership(db, userId);
  if (found) return found;
  const householdId = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(schema.household).values({ id: householdId, name: name ? `${name}'s household` : "My household" }),
      db.insert(schema.householdMember).values({ householdId, userId, role: "owner", isDefault: true }),
    ]);
  } catch (error) {
    // A concurrent first request created it (the one-default-per-user index refused the second).
    const raced = await activeMembership(db, userId);
    if (raced) return raced;
    throw error;
  }
  await seedCategories(db, householdId);
  return householdId;
}

/** The default membership; a user left without one (removed from it) falls back to their oldest. */
async function activeMembership(db: Database, userId: string): Promise<string | null> {
  const m = schema.householdMember;
  const [row] = await db
    .select({ householdId: m.householdId, isDefault: m.isDefault })
    .from(m)
    .where(eq(m.userId, userId))
    .orderBy(desc(m.isDefault), asc(m.createdAt))
    .limit(1);
  if (!row) return null;
  if (!row.isDefault) await setDefaultHousehold(db, userId, row.householdId);
  return row.householdId;
}

/** Makes one of the user's memberships the default. Clears the old one first: the unique index allows one. */
export async function setDefaultHousehold(db: Database, userId: string, householdId: string): Promise<void> {
  const m = schema.householdMember;
  await db.batch([
    db.update(m).set({ isDefault: false }).where(and(eq(m.userId, userId), eq(m.isDefault, true))),
    db.update(m).set({ isDefault: true }).where(and(eq(m.userId, userId), eq(m.householdId, householdId))),
  ]);
}
