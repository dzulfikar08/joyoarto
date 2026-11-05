// The waitlist from before sign-up was open. Nobody can join any more; the rows already there are kept so the
// operators (env ADMIN_EMAILS) can read them and contact those people.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";

const w = schema.waitlistSignup;

export const listInput = z.object({ limit: z.number().int().min(1).max(1000).default(200), offset: z.number().int().min(0).default(0) });

export async function listWaitlist(db: Database, input: z.infer<typeof listInput>) {
  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)` }).from(w);
  const banks = await db.all<{ bank: string; count: number }>(
    sql`select j.value as bank, count(*) as count from ${w}, json_each(${w.banks}) j group by j.value order by count desc, bank`,
  );
  const rows = await db.select().from(w).orderBy(desc(w.createdAt)).limit(input.limit).offset(input.offset);
  return {
    count,
    banks,
    signups: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      banks: r.banks,
      source: r.source,
      utm: r.utm,
      locale: r.locale,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
