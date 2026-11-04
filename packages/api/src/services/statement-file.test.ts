// POST /api/imports/statement-file through the same OpenAPI handler setup as apps/server (multipart body, coercion of
// commit="true"), with principals resolved from `brk_` tokens the way the server does.

import { beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { count, eq } from "drizzle-orm";

import type { Principal } from "../context";
import { sampleJagoText } from "../lib/statements/sample";
import { appRouter } from "../routers/index";
import { testDb, testPrincipal } from "../test/d1";
import { makePdf } from "../test/pdf";
import { createToken, principalFromToken } from "./tokens";

const handler = new OpenAPIHandler(appRouter, { plugins: [new SmartCoercionPlugin({ schemaConverters: [new ZodToJsonSchemaConverter()] })] });

let db: Database;
let rina: Principal;
let budi: Principal;

beforeEach(async () => {
  ({ db } = await testDb());
  rina = await testPrincipal(db, "Rina");
  budi = await testPrincipal(db, "Budi");
});

async function upload(token: string | null, pdf: Uint8Array, commit?: string, name = "jago-oct.pdf") {
  const form = new FormData();
  form.append("file", new File([pdf], name, { type: "application/pdf" }));
  if (commit !== undefined) form.append("commit", commit);
  const request = new Request("http://x/api/imports/statement-file", { method: "POST", body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const principal = token ? await principalFromToken(db, token) : null;
  const { response } = await handler.handle(request, { prefix: "/api", context: { db, principal } });
  return { status: response!.status, body: (await response!.json()) as Record<string, unknown> };
}

async function txCount(householdId: string) {
  const [r] = await db.select({ n: count() }).from(schema.transaction).where(eq(schema.transaction.householdId, householdId));
  return r!.n;
}

describe("POST /api/imports/statement-file", () => {
  test("needs a token, and one with finance:write", async () => {
    expect((await upload(null, makePdf(sampleJagoText()))).status).toBe(401);
    expect((await upload("brk_not-a-real-token", makePdf(sampleJagoText()))).status).toBe(401);
    const readOnly = await createToken(db, rina, { name: "phone", scopes: ["finance:read"] });
    const res = await upload(readOnly.token, makePdf(sampleJagoText()), "true");
    expect(res.status).toBe(403);
    expect(await txCount(rina.householdId)).toBe(0);
  });

  test("commit defaults to false (preview); commit=true saves into the token owner's household only", async () => {
    const { token } = await createToken(db, rina, { name: "phone", scopes: ["finance:read", "finance:write"] });
    const preview = await upload(token, makePdf(sampleJagoText()));
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ kind: "jago", committed: false, balancesVerified: true, period: { from: "2026-10-01" } });
    expect(await txCount(rina.householdId)).toBe(0);

    const saved = await upload(token, makePdf(sampleJagoText()), "true");
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ kind: "jago", committed: true });
    const inserted = (saved.body.totals as { inserted: number }).inserted;
    expect(inserted).toBeGreaterThan(5);
    expect(await txCount(rina.householdId)).toBe(inserted);
    expect(await txCount(budi.householdId)).toBe(0);
    const [batch] = await db.select().from(schema.importBatch).where(eq(schema.importBatch.householdId, rina.householdId));
    expect(batch).toMatchObject({ source: "pdf", fileName: "jago-oct.pdf", createdBy: rina.userId });

    // "false" is false, not a truthy string.
    expect((await upload(token, makePdf(sampleJagoText()), "false")).body).toMatchObject({ committed: false });
  });

  test("password-protected, non-PDF and unknown statements are 400s with a reason", async () => {
    const { token } = await createToken(db, budi, { name: "phone", scopes: ["finance:write"] });
    const locked = await upload(token, makePdf("x", { encrypted: true }), "true", "bca.pdf");
    expect(locked.status).toBe(400);
    expect(locked.body).toMatchObject({ code: "BAD_REQUEST", data: { reason: "encrypted" } });
    expect((await upload(token, new TextEncoder().encode("hello"), "true")).body).toMatchObject({ data: { reason: "invalid" } });
    const other = await upload(token, makePdf("Some other bank\nSaldo 100"), "true");
    expect(other.status).toBe(400);
    expect(String(other.body.message)).toContain("Not a statement JoyoArto can read");
  });
});
