import { beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { eq } from "drizzle-orm";

import type { AiConfig, AturConfig, Principal } from "../context";
import { sampleJagoText } from "../lib/statements/sample";
import { testDb, testPrincipal } from "../test/d1";
import { ACCOUNT, MERCHANTS, PERSON, bcaStatement } from "../test/statements";
import { FORMAT_REQUESTS_PER_DAY, formatPreview, requestFormat } from "./statement-formats";
import { importStatement } from "./statements";

let db: Database;
let rina: Principal;
let budi: Principal;
let sent: { url: string; body: Record<string, unknown> }[];
let answer: () => Response;

function atur(): AturConfig {
  return {
    ingestKey: "ing_test",
    environment: "test",
    fetch: async (url, init) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return answer();
    },
  };
}

/** A Workers AI stand-in that records what it was given. */
function fakeAi(seen: string[]): AiConfig {
  return {
    anthropicKey: null,
    anthropicBaseUrl: "https://api.anthropic.com",
    chatModel: "x",
    parseModel: "x",
    effort: "low",
    workersAi: {
      run: async (_model, input) => {
        seen.push(JSON.stringify(input));
        return { response: "## Likely bank\nBCA-like rekening koran.\n\n## Date format\n99/99 (day/month, no year)." };
      },
    },
    workersAiModel: "@cf/test/model",
    dailyCap: 30,
    captureCap: 60,
    fakeTranscript: false,
  };
}

beforeEach(async () => {
  ({ db } = await testDb());
  rina = await testPrincipal(db, "Rina");
  budi = await testPrincipal(db, "Budi");
  sent = [];
  answer = () => Response.json({ issue_id: "iss_1", sequence_id: 52, occurrences: 1, created: true });
});

const secrets = [...PERSON, ACCOUNT, ...MERCHANTS, "KENANGA", "BUDI HARTONO", "4.512.300", "Rina", "Budi"];

describe("importStatement", () => {
  test("an unsupported statement is refused with data.reason unsupported", async () => {
    const err = await importStatement(db, rina, { text: bcaStatement(5), commit: false }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST", data: { reason: "unsupported" } });
  });
});

describe("formatPreview", () => {
  test("shows the skeleton; off when the server has no ingest key", async () => {
    const p = await formatPreview(db, rina, null, { text: bcaStatement(10) });
    expect(p.available).toBe(false);
    expect(p.skeleton).toContain("TANGGAL KETERANGAN XXXX MUTASI SALDO");
    for (const s of secrets) expect(p.skeleton).not.toContain(s);
    expect(p).toMatchObject({ alreadyRequested: false, requestsLeftToday: FORMAT_REQUESTS_PER_DAY, pages: 2 });
    expect((await formatPreview(db, rina, atur(), { text: bcaStatement(10) })).available).toBe(true);
  });

  test("refuses statements JoyoArto already reads", async () => {
    expect(formatPreview(db, rina, atur(), { text: sampleJagoText() })).rejects.toMatchObject({ data: { reason: "supported" } });
  });
});

describe("requestFormat", () => {
  test("files the skeleton and an AI spec built from the skeleton only; never the member's data", async () => {
    const seen: string[] = [];
    const res = await requestFormat(db, rina, atur(), fakeAi(seen), { text: bcaStatement(30), source: "pdf", platform: "web" });
    expect(res).toEqual({ filed: true, alreadyRequested: false, issue: { number: 52, occurrences: 1 } });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://app.diatur.com/api/ingest/ing_test");
    const body = sent[0]!.body;
    expect(body).toMatchObject({ level: "info", service: "statement-formats", environment: "test" });
    expect(String(body.message).split("\n")[0]).toMatch(/^Statement format request: unknown \([0-9a-f]{8}\)$/);
    expect(String(body.fingerprint)).toMatch(/^stmt-[0-9a-f]{16}$/);
    expect(String(body.stack)).toContain("## Parser spec (AI: @cf/test/model");
    expect(String(body.stack)).toContain("99/99 TRSF E-BANKING DB 9999/XXXX/XXXX99999");
    expect(body.context).toEqual({ bankGuess: null, lines: 107, skeletonLines: 107, pages: 2, source: "pdf", platform: "web", aiSpec: "@cf/test/model" });

    const everything = JSON.stringify(body) + seen.join("");
    for (const s of [...secrets, rina.userId, rina.householdId, `${rina.userId}@example.com`]) expect(everything).not.toContain(s);
    expect(seen.join("")).toContain("TANGGAL KETERANGAN XXXX MUTASI SALDO");

    const [row] = await db.select().from(schema.statementFormatRequest).where(eq(schema.statementFormatRequest.householdId, rina.householdId));
    expect(row).toMatchObject({ userId: rina.userId, aturIssueId: "iss_1", fingerprint: body.fingerprint });
  });

  test("without AI the skeleton is filed alone", async () => {
    await requestFormat(db, rina, atur(), undefined, { text: bcaStatement(8), source: "app", platform: "android" });
    expect(String(sent[0]!.body.stack)).toContain("(No AI spec: write it from the skeleton.)");
  });

  test("the same format once per household; the other household still counts", async () => {
    const first = await requestFormat(db, rina, atur(), undefined, { text: bcaStatement(8), source: "pdf", platform: "web" });
    expect(first.filed).toBe(true);
    const again = await requestFormat(db, rina, atur(), undefined, { text: bcaStatement(20, { holder: "AGUS SANTOSO", month: "NOVEMBER 2026" }), source: "pdf", platform: "web" });
    expect(again).toEqual({ filed: false, alreadyRequested: true, issue: null });
    expect((await formatPreview(db, rina, atur(), { text: bcaStatement(3) })).alreadyRequested).toBe(true);
    expect(sent).toHaveLength(1);
    const other = await requestFormat(db, budi, atur(), undefined, { text: bcaStatement(8), source: "pdf", platform: "web" });
    expect(other.filed).toBe(true);
    expect(sent[1]!.body.fingerprint).toBe(sent[0]!.body.fingerprint);
  });

  test(`at most ${FORMAT_REQUESTS_PER_DAY} a day per member`, async () => {
    const formats = Array.from({ length: FORMAT_REQUESTS_PER_DAY + 1 }, (_, i) => `BANK FORMAT ${"ABCDEFGH"[i]}\nTanggal Keterangan Saldo${" Debit".repeat(i + 1)}\n01/02 X 1,00\n02/02 Y 2,00`);
    for (const text of formats.slice(0, -1)) expect((await requestFormat(db, rina, atur(), undefined, { text, source: "pdf", platform: "web" })).filed).toBe(true);
    expect(requestFormat(db, rina, atur(), undefined, { text: formats.at(-1)!, source: "pdf", platform: "web" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  test("a failed post gives the slot back", async () => {
    answer = () => new Response("nope", { status: 500 });
    expect(requestFormat(db, rina, atur(), undefined, { text: bcaStatement(8), source: "pdf", platform: "web" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await Bun.sleep(0);
    expect(await db.select().from(schema.statementFormatRequest)).toHaveLength(0);
    answer = () => Response.json({ issue_id: "iss_2", sequence_id: 53, occurrences: 1, created: true });
    expect((await requestFormat(db, rina, atur(), undefined, { text: bcaStatement(8), source: "pdf", platform: "web" })).filed).toBe(true);
  });

  test("off without a key; AI connections cannot send", async () => {
    expect(requestFormat(db, rina, null, undefined, { text: bcaStatement(8), source: "pdf", platform: "web" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(requestFormat(db, { ...rina, via: "oauth" }, atur(), undefined, { text: bcaStatement(8), source: "pdf", platform: "web" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sent).toHaveLength(0);
  });
});
