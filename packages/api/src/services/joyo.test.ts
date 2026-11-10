import { beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { AiConfig, Context, Principal } from "../context";
import { runChat } from "../lib/joyo-ai/chat";
import type { Engine } from "../lib/joyo-ai/chat";
import { reserveSlot, wibDayStart } from "../lib/joyo-ai/limits";
import { chatToolSpecs, describeProposal } from "../lib/joyo-ai/tools";
import type { Adapter, ModelReply, ModelRequest } from "../lib/joyo-ai/types";
import { appRouter } from "../routers/index";
import { testAccount, testDb, testPrincipal } from "../test/d1";
import { toolCatalog } from "../tools";

let db: Database;
let dewi: Principal;
let stranger: Principal;

beforeEach(async () => {
  ({ db } = await testDb());
  dewi = await testPrincipal(db, "Dewi");
  stranger = await testPrincipal(db, "Stranger");
  await testAccount(db, dewi, "GoPay");
});

const reply = (r: Partial<ModelReply>): ModelReply => ({ text: "", thinking: "", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stop: "end", finish: "end_turn", ...r });

/** A model that answers with the scripted replies in order, and remembers what it was sent. */
function scripted(replies: ModelReply[]) {
  const seen: ModelRequest[] = [];
  const adapter: Adapter = {
    async complete(_conn, request, options) {
      seen.push({ ...request, messages: [...request.messages] });
      const next = replies.shift();
      if (!next) throw new Error("no more replies");
      if (next.text) options?.onDelta?.({ text: next.text });
      return next;
    },
    async listModels() {
      return [];
    },
  };
  const engine: Engine = { kind: "hosted", provider: "claude", adapter, conn: { baseUrl: "x", apiKey: "k", model: "claude-opus-5-5" } };
  return { engine, seen };
}

function aiConfig(adapterEngine?: Engine): AiConfig {
  void adapterEngine;
  return {
    anthropicKey: null,
    anthropicBaseUrl: "https://api.anthropic.com",
    chatModel: "claude-opus-5-5",
    parseModel: "claude-opus-5-5",
    effort: "medium",
    workersAi: null,
    workersAiModel: "m",
    dailyCap: 2,
    captureCap: 5,
    fakeTranscript: true,
  };
}

const person = { name: "Dewi", household: "Rumah", today: "2026-11-04" };

describe("tool catalog", () => {
  test("chat tools read or propose, and never import, delete or create accounts", () => {
    const chat = toolCatalog().filter((t) => t.chat);
    expect(chat.map((t) => t.name)).not.toContain("undo_import");
    expect(chat.map((t) => t.name)).not.toContain("delete_scenario");
    expect(chat.map((t) => t.name)).not.toContain("create_account");
    for (const t of chat) expect(t.chat === "read" ? t.scope : "finance:read").toBe("finance:read");
    expect(chat.find((t) => t.name === "quick_add")?.chat).toBe("propose");
  });
  test("every chat tool has an object schema", () => {
    for (const spec of chatToolSpecs()) expect(spec.parameters.type).toBe("object");
    expect(Object.keys(chatToolSpecs().find((s) => s.name === "search_transactions")?.parameters.properties ?? {}).length).toBeGreaterThan(3);
  });
});

describe("runChat", () => {
  test("beside the Plan page: the prompt carries the page, and a successful compare_plans streams its scenarios", async () => {
    const scenarios = [{ name: "Car A", items: [{ type: "oneOff", label: "DP", month: "2027-01", amount: 5_000_000_00, direction: "out" }] }];
    const { engine, seen } = scripted([
      reply({ toolCalls: [{ id: "t1", name: "compare_plans", args: { scenarios, horizonMonths: 24 } }], stop: "tools" }),
      reply({ text: "Car A is tight." }),
    ]);
    const events: { type: string; tool?: string; args?: unknown }[] = [];
    const page = JSON.stringify({ horizonMonths: 24, scenarios: [] });
    const answer = await runChat({ engine, context: { db, principal: dewi }, person: { ...person, planPage: page }, turns: [{ role: "user", content: "try car A" }], onEvent: (e) => events.push(e) });
    expect(answer.steps[0]).toMatchObject({ tool: "compare_plans", ok: true });
    expect(events.filter((e) => e.type === "plan")).toEqual([{ type: "plan", tool: "compare_plans", args: { scenarios, horizonMonths: 24 } }]);
    expect(seen[0]!.system).toContain("beside the member's Plan page");
    expect(seen[0]!.system).toContain(page);
  });

  test("attachments reach the model with the last question only: text as labelled blocks, images alongside", async () => {
    const { engine, seen } = scripted([reply({ text: "Cicilannya Rp 4,1 jt." })]);
    await runChat({
      engine,
      context: { db, principal: dewi },
      person,
      turns: [
        { role: "user", content: "halo" },
        { role: "assistant", content: "Hai" },
        { role: "user", content: "cek simulasi ini" },
      ],
      attachments: [
        { kind: "text", name: "simulasi.pdf", text: "Harga 250.000.000\nDP 30%\nTenor 60" },
        { kind: "image", name: "brosur.jpg", mediaType: "image/jpeg", data: "QUJD" },
      ],
    });
    const sent = seen[0]!.messages;
    expect(sent[0]).toEqual({ role: "user", content: "halo" });
    const last = sent.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.role === "user" && last.content).toContain('<attachment name="simulasi.pdf">');
    expect(last.role === "user" && last.content).toContain("Tenor 60");
    expect(last.role === "user" && last.content).toContain("brosur.jpg");
    expect(last.role === "user" && last.images).toEqual([{ mediaType: "image/jpeg", data: "QUJD" }]);
    expect(seen[0]!.system).toContain("<attachment> tags");
  });

  test("no plan event for a failed plan call, and no page rules without a page", async () => {
    const { engine, seen } = scripted([reply({ toolCalls: [{ id: "t1", name: "compare_plans", args: { scenarios: [] } }], stop: "tools" }), reply({ text: "ok" })]);
    const events: { type: string }[] = [];
    await runChat({ engine, context: { db, principal: dewi }, person, turns: [{ role: "user", content: "compare" }], onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.type === "plan")).toBe(false);
    expect(seen[0]!.system).not.toContain("beside the member's Plan page");
  });

  test("reads through the member's own household and proposes writes without running them", async () => {
    const { engine, seen } = scripted([
      reply({ toolCalls: [{ id: "t1", name: "list_accounts", args: {} }, { id: "t2", name: "quick_add", args: { amountText: "25rb", description: "kopi kenangan" } }], stop: "tools" }),
      reply({ text: "Saldo GoPay ada. Konfirmasi kartu di bawah untuk menyimpan kopi." }),
    ]);
    const context: Context = { db, principal: dewi };
    const answer = await runChat({ engine, context, person, turns: [{ role: "user", content: "catat kopi 25rb" }] });
    expect(answer.reply).toContain("Konfirmasi");
    expect(answer.steps.map((s) => [s.tool, s.ok])).toEqual([
      ["list_accounts", true],
      ["quick_add", true],
    ]);
    expect(answer.proposals).toHaveLength(1);
    expect(answer.proposals[0]).toMatchObject({ tool: "quick_add", status: "pending" });
    // Nothing was saved.
    expect(await db.select().from(schema.transaction)).toHaveLength(0);
    // The second call saw both tool results; the accounts are Dewi's only.
    const toolMessages = seen[1]!.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]!.role === "tool" && toolMessages[0]!.content).toContain("GoPay");
    expect(seen[0]!.system).toContain("Today is 2026-11-04");
  });

  test("invalid arguments go back to the model as an error", async () => {
    const { engine, seen } = scripted([reply({ toolCalls: [{ id: "t1", name: "set_budget", args: { amount: "lots" } }], stop: "tools" }), reply({ text: "ok" })]);
    const answer = await runChat({ engine, context: { db, principal: dewi }, person, turns: [{ role: "user", content: "budget" }] });
    expect(answer.proposals).toHaveLength(0);
    const tool = seen[1]!.messages.find((m) => m.role === "tool");
    expect(tool?.role === "tool" && tool.content).toContain("Invalid arguments");
  });
});

describe("daily cap", () => {
  test("a slot is refused once the day is full, and the next WIB day starts again", async () => {
    const now = Date.UTC(2026, 10, 4, 10);
    const slot = { userId: dewi.userId, householdId: dewi.householdId, kind: "chat" as const, engine: "hosted" as const, model: "m", cap: 2 };
    expect(await reserveSlot(db, slot, now)).not.toBeNull();
    expect(await reserveSlot(db, slot, now)).not.toBeNull();
    expect(await reserveSlot(db, slot, now)).toBeNull();
    // Own-key calls have their own count.
    expect(await reserveSlot(db, { ...slot, engine: "byok" }, now)).not.toBeNull();
    expect(await reserveSlot(db, slot, wibDayStart(now) + 86_400_000)).not.toBeNull();
  });
});

describe("joyo router", () => {
  test("off without an engine; proposals are confirmed from the stored message only, by the owner", async () => {
    const ctx = (principal: Principal, ai?: AiConfig): Context => ({ db, principal, ...(ai ? { ai } : {}) });
    const drain = async () => {
      for await (const event of await call(appRouter.joyo.chat, { message: "halo" }, { context: ctx(dewi, aiConfig()) })) void event;
    };
    await expect(drain()).rejects.toThrow(/off/i);

    // A stored answer with a pending quick add.
    const { engine } = scripted([reply({ toolCalls: [{ id: "t1", name: "quick_add", args: { amountText: "25rb", description: "kopi" } }], stop: "tools" }), reply({ text: "Konfirmasi ya." })]);
    const answer = await runChat({ engine, context: ctx(dewi), person, turns: [{ role: "user", content: "kopi 25rb" }] });
    const conv = crypto.randomUUID();
    await db.insert(schema.joyoConversation).values({ id: conv, householdId: dewi.householdId, userId: dewi.userId, title: "kopi" });
    const messageId = crypto.randomUUID();
    await db.insert(schema.joyoMessage).values({ id: messageId, conversationId: conv, role: "assistant", content: answer.reply, proposals: answer.proposals });
    const proposalId = answer.proposals[0]!.id;

    await expect(call(appRouter.joyo.proposal, { messageId, proposalId, action: "confirm" }, { context: ctx(stranger) })).rejects.toThrow();
    const first = await call(appRouter.joyo.proposal, { messageId, proposalId, action: "confirm" }, { context: ctx(dewi) });
    expect(first.proposal.status).toBe("done");
    const second = await call(appRouter.joyo.proposal, { messageId, proposalId, action: "confirm" }, { context: ctx(dewi) });
    expect(second.proposal.status).toBe("done");
    const rows = await db.select().from(schema.transaction).where(eq(schema.transaction.householdId, dewi.householdId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: -2_500_000, capturedVia: "joyo" });

    // Conversations are private: the stranger sees none of Dewi's.
    expect((await call(appRouter.joyo.conversations.list, undefined, { context: ctx(stranger) })).conversations).toHaveLength(0);
    expect((await call(appRouter.joyo.conversations.list, undefined, { context: ctx(dewi) })).conversations).toHaveLength(1);
  });
});

describe("read-only", () => {
  const ctx = (principal: Principal): Context => ({ db, principal });

  test("the setting is per member and household, off by default", async () => {
    expect((await call(appRouter.joyo.settings, { readOnly: true }, { context: ctx(dewi) })).readOnly).toBe(true);
    expect((await call(appRouter.joyo.status, undefined, { context: ctx(dewi) })).readOnly).toBe(true);
    expect((await call(appRouter.joyo.status, undefined, { context: ctx(stranger) })).readOnly).toBe(false);
    // A read-only token cannot turn it off.
    await expect(call(appRouter.joyo.settings, { readOnly: false }, { context: ctx({ ...dewi, scopes: ["finance:read"], via: "token" }) })).rejects.toThrow(/finance:write/);
  });

  test("the model gets no propose tools, is told it is read-only, and a write call proposes nothing", async () => {
    const { engine, seen } = scripted([
      reply({ toolCalls: [{ id: "t1", name: "quick_add", args: { amountText: "25rb", description: "kopi" } }, { id: "t2", name: "list_accounts", args: {} }], stop: "tools" }),
      reply({ text: "Aku cuma bisa membaca; tambahkan lewat tombol +." }),
    ]);
    const answer = await runChat({ engine, context: ctx(dewi), person: { ...person, readOnly: true }, turns: [{ role: "user", content: "catat kopi 25rb" }] });
    const offered = seen[0]!.tools?.map((t) => t.name) ?? [];
    const propose = toolCatalog().filter((t) => t.chat === "propose").map((t) => t.name);
    expect(propose.length).toBeGreaterThan(0);
    for (const name of propose) expect(offered).not.toContain(name);
    expect(offered).toContain("list_accounts");
    expect(seen[0]!.system).toContain("read-only");
    expect(seen[0]!.system).not.toContain("only PROPOSED here");
    expect(answer.proposals).toHaveLength(0);
    const refused = seen[1]!.messages.find((m) => m.role === "tool" && m.callId === "t1");
    expect(refused?.role === "tool" && refused.content).toContain("read-only");
    expect(await db.select().from(schema.transaction)).toHaveLength(0);

    // Not read-only: the same tools are offered as before.
    const normal = scripted([reply({ text: "ok" })]);
    await runChat({ engine: normal.engine, context: ctx(dewi), person, turns: [{ role: "user", content: "halo" }] });
    expect(normal.seen[0]!.tools?.map((t) => t.name)).toContain("quick_add");
  });

  test("confirming a proposal is refused while read-only is on; dismissing still works", async () => {
    const { engine } = scripted([reply({ toolCalls: [{ id: "t1", name: "quick_add", args: { amountText: "25rb", description: "kopi" } }], stop: "tools" }), reply({ text: "Konfirmasi ya." })]);
    const answer = await runChat({ engine, context: ctx(dewi), person, turns: [{ role: "user", content: "kopi 25rb" }] });
    const conv = crypto.randomUUID();
    await db.insert(schema.joyoConversation).values({ id: conv, householdId: dewi.householdId, userId: dewi.userId, title: "kopi" });
    const messageId = crypto.randomUUID();
    await db.insert(schema.joyoMessage).values({ id: messageId, conversationId: conv, role: "assistant", content: answer.reply, proposals: answer.proposals });
    const proposalId = answer.proposals[0]!.id;

    await call(appRouter.joyo.settings, { readOnly: true }, { context: ctx(dewi) });
    await expect(call(appRouter.joyo.proposal, { messageId, proposalId, action: "confirm" }, { context: ctx(dewi) })).rejects.toThrow(/read-only/);
    expect(await db.select().from(schema.transaction)).toHaveLength(0);
    const [stored] = await db.select().from(schema.joyoMessage).where(eq(schema.joyoMessage.id, messageId));
    expect((stored!.proposals as { status: string }[])[0]!.status).toBe("pending");
    expect((await call(appRouter.joyo.proposal, { messageId, proposalId, action: "dismiss" }, { context: ctx(dewi) })).proposal.status).toBe("dismissed");
  });
});

describe("capture", () => {
  test("parse falls back to rules without a key; transcribe answers the dev transcript without a binding", async () => {
    const context: Context = { db, principal: dewi, ai: aiConfig() };
    const parsed = await call(appRouter.capture.parse, { text: "kopi 25rb gopay" }, { context });
    expect(parsed.draft).toMatchObject({ amount: 2_500_000, direction: "out", source: "rules" });
    const heard = await call(appRouter.capture.transcribe, { audio: new File([new Uint8Array(2000)], "v.webm", { type: "audio/webm" }) }, { context });
    expect(heard.text).toContain("kopi");
  });

  test("nothing reaches an AI before the member allows it", async () => {
    const seen: unknown[] = [];
    const ai: AiConfig = { ...aiConfig(), fakeTranscript: false, workersAi: { run: async (_m, input) => (seen.push(input), { text: "kopi 25rb", response: "{}" }) } };
    const context: Context = { db, principal: dewi, ai };
    const audio = () => ({ audio: new File([new Uint8Array(2000)], "v.webm", { type: "audio/webm" }) });

    expect((await call(appRouter.account.aiConsent, undefined, { context })).allowed).toBe(false);
    await expect(call(appRouter.capture.transcribe, audio(), { context })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", data: { aiConsent: true } });
    const parsed = await call(appRouter.capture.parse, { text: "kopi 25rb gopay" }, { context });
    expect(parsed.draft.source).toBe("rules");
    expect(seen).toHaveLength(0);

    await call(appRouter.account.setAiConsent, { allow: true }, { context });
    expect((await call(appRouter.joyo.status, undefined, { context })).aiConsent).toBe(true);
    await call(appRouter.capture.transcribe, audio(), { context });
    expect(seen.length).toBeGreaterThan(0);

    // Withdrawn: refused again.
    await call(appRouter.account.setAiConsent, { allow: false }, { context });
    await expect(call(appRouter.capture.transcribe, audio(), { context })).rejects.toMatchObject({ data: { aiConsent: true } });
  });
});

test("quick_add proposals show the sign the server will save", async () => {
  expect(describeProposal("quick_add", { amountText: "25rb CR", description: "refund" })).toBe("+Rp 25.000 · refund");
  expect(describeProposal("quick_add", { amountText: "25rb", description: "kopi" })).toBe("−Rp 25.000 · kopi");
  expect(describeProposal("quick_add", { amountText: "+500k", description: "gaji" })).toBe("+Rp 500.000 · gaji");
  expect(describeProposal("quick_add", { amountText: "25rb", direction: "in", description: "x" })).toBe("+Rp 25.000 · x");
  expect(describeProposal("quick_add", { amount: -2_500_000, description: "x" })).toBe("−Rp 25.000 · x");
  expect(describeProposal("quick_add", { amountText: "abc", description: "x" })).toBe("? · x");
  // The server agrees on "25rb CR".
  const { db } = await testDb();
  const p = await testPrincipal(db);
  const accountId = await testAccount(db, p);
  const saved = await call(appRouter.transactions.quickAdd, { accountId, amountText: "25rb CR", description: "refund" }, { context: { db, principal: p } as never });
  expect(saved.transaction.amount).toBe(2_500_000);
});

