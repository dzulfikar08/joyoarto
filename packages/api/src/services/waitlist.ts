// Public waitlist for hosted baroka. Anyone can join without an account; only operators (env ADMIN_EMAILS) can read
// it. The answer to a join never says whether the address was already on the list, so it cannot be used to probe.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";

const w = schema.waitlistSignup;

/** Banks and e-wallets offered on the form; anything else is kept as typed (lowercased) so we learn what to add. */
export const WAITLIST_BANKS = ["jago", "gopay", "bca", "bri", "mandiri", "bni", "dana", "ovo", "shopeepay", "seabank", "blu", "jenius"] as const;

export const joinInput = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email({ message: "Alamat email belum benar." })),
  name: z.string().trim().max(80).optional(),
  banks: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9][a-z0-9 .-]{0,29}$/),
    )
    .max(12)
    .default([]),
  /** "landing", "demo", ... */
  source: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\w.-]*$/)
    .optional(),
  utm: z
    .record(z.string().regex(/^utm_[a-z]{1,12}$/), z.string().max(100))
    .refine((r) => Object.keys(r).length <= 5, "Too many utm fields.")
    .optional(),
  locale: z.enum(["id", "en"]).optional(),
  /** Honeypot: a hidden field people never fill in. When it has a value the request is answered but not stored. */
  website: z.string().max(500).optional(),
});
export type JoinInput = z.infer<typeof joinInput>;

export async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`waitlist:${salt}:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Idempotent on email: joining twice keeps the first sign-up and answers the same. */
export async function joinWaitlist(db: Database, input: JoinInput, ipHash: string | null = null) {
  const ok = { ok: true as const, message: "Kamu sudah masuk waitlist. Kami kabari lewat email saat JoyoArto Pro dibuka." };
  if (input.website) return ok;
  await db
    .insert(w)
    .values({
      id: crypto.randomUUID(),
      email: input.email,
      name: input.name || null,
      banks: [...new Set(input.banks)],
      source: input.source || input.utm?.utm_source || null,
      utm: input.utm && Object.keys(input.utm).length ? input.utm : null,
      locale: input.locale ?? null,
      ipHash,
    })
    .onConflictDoNothing({ target: w.email });
  return ok;
}

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
