// Joyo AI's tools: the entries of the shared catalog (src/tools.ts) marked `chat`, run with oRPC's `call` under the
// caller's own context, so a tool reaches exactly what the REST API and the MCP server would give this member: their
// active household, their token's scopes. Reads run as the model asks. Writes never run here: they become a proposal
// the member confirms in the chat (routers/joyo.ts runs it then, with exactly these arguments).

import { ORPCError, call } from "@orpc/server";
import { z } from "zod";

import type { Context } from "../../context";
import { quickAddAmount } from "../amount-text";
import { formatMoney } from "../money";
import { toolCatalog, toolInput } from "../../tools";
import type { ToolDef } from "../../tools";
import type { ToolCall, ToolSpec } from "./types";

/** A tool result is cut at this many characters: one search page or a 36-month projection fits, a runaway does not. */
export const TOOL_RESULT_CHARS = 24_000;

export type Proposal = {
  id: string;
  tool: string;
  title: string;
  /** One line for the card, in plain words. */
  summary: string;
  args: Record<string, unknown>;
  status: "pending" | "done" | "dismissed" | "failed";
  /** After it ran: what happened (the new row, how many changed) or why it failed. */
  result?: string;
};

/** A tool the answer ran: the name and its plain arguments, never what it returned. */
export type Step = {
  id: string;
  tool: string;
  title: string;
  args: Record<string, string | number | boolean>;
  ok: boolean;
};

export function chatTools(): ToolDef[] {
  return toolCatalog().filter((t) => t.chat !== undefined);
}

export function chatTool(name: string): ToolDef | undefined {
  return chatTools().find((t) => t.name === name);
}

const PROPOSE_NOTE =
  " In this chat, calling it only PROPOSES the change: the member sees a card with Confirm and Dismiss, and nothing is saved until they confirm. Say so; never say it is done.";

let specs: ToolSpec[] | null = null;

/** JSON Schemas of the chat tools, from the same zod inputs the procedures validate with. */
export function chatToolSpecs(): ToolSpec[] {
  specs ??= chatTools().map((def) => {
    const input = toolInput(def);
    let parameters: ToolSpec["parameters"] = { type: "object", properties: {} };
    if (input) {
      const json = z.toJSONSchema(input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
      parameters = {
        type: "object",
        properties: (json.properties as Record<string, unknown> | undefined) ?? {},
        ...(Array.isArray(json.required) && json.required.length ? { required: json.required as string[] } : {}),
      };
    }
    return { name: def.name, description: def.chat === "propose" ? def.description + PROPOSE_NOTE : def.description, parameters };
  });
  return specs;
}

/** Plain arguments for the steps list: scalars only, short. */
function plainArgs(args: Record<string, unknown>): Step["args"] {
  const out: Step["args"] = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 60);
    else if (Array.isArray(v)) out[k] = `${v.length} items`;
  }
  return out;
}

function errorText(error: unknown): string {
  if (error instanceof ORPCError) {
    const issues = (error.data as { issues?: { path?: (string | number)[]; message: string }[] } | undefined)?.issues;
    if (issues?.length) return `${error.message}: ${issues.map((i) => `${(i.path ?? []).join(".") || "input"}: ${i.message}`).join("; ")}`;
    return error.message;
  }
  console.error("[joyo] tool failed", error instanceof Error ? error.name : typeof error);
  return "Internal error in this tool.";
}

const idr = (v: unknown): string | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return `Rp ${Math.round(Math.abs(v) / 100).toLocaleString("id-ID")}`;
};

/** One line describing a proposed write, from its arguments only (nothing is looked up). */
export function describeProposal(tool: string, a: Record<string, unknown>): string {
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : null);
  switch (tool) {
    case "quick_add": {
      // The same reading as the server's quickAdd, so "25rb CR" is shown as money in, as it is saved.
      let shown = "?";
      try {
        const amount = quickAddAmount({
          amount: typeof a.amount === "number" && Number.isFinite(a.amount) ? a.amount : undefined,
          amountText: s("amountText") ?? undefined,
          rawText: s("rawText") ?? undefined,
          direction: a.direction === "in" || a.direction === "out" ? a.direction : undefined,
        });
        shown = `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount), "IDR")}`;
      } catch {
        // Unreadable amount: the server will refuse it too.
      }
      return [shown, s("merchant") ?? s("description"), s("category"), s("occurredAt")].filter(Boolean).join(" · ");
    }
    case "categorize": {
      const n = Array.isArray(a.ids) ? a.ids.length : 0;
      return `${n} transaction${n === 1 ? "" : "s"} → ${s("category") ?? "?"}${a.createRule ? " (and remember as a rule)" : ""}`;
    }
    case "update_transaction":
      return ["Edit transaction", s("category") && `category ${s("category")}`, s("merchant") && `merchant "${s("merchant")}"`, s("note") && `note "${s("note")}"`].filter(Boolean).join(" · ");
    case "create_rule":
      return `Rule: ${s("field") ?? "merchant"} ${s("match") ?? "contains"} "${s("pattern") ?? s("value") ?? "?"}" → ${s("category") ?? s("setMerchant") ?? "?"}`;
    case "set_budget":
      return `Budget ${s("category") ?? "?"}: ${a.amount === 0 ? "remove" : `${idr(a.amount) ?? "?"} a month`}`;
    case "save_scenario":
      return `Save scenario "${s("name") ?? "?"}"${typeof a.id === "string" ? " (update)" : ""}`;
    case "mark_reimbursable": {
      const n = Array.isArray(a.ids) ? a.ids.length : 0;
      return `${n} transaction${n === 1 ? "" : "s"} → ${a.reimbursable === false ? "ordinary spending (not reimbursable)" : "reimbursable (diganti kantor)"}`;
    }
    case "set_claim_status":
      return `Claim → ${s("status") ?? "?"}${s("paymentTransactionId") ? " (with the employer's payment)" : ""}${Array.isArray(a.rejectIds) && a.rejectIds.length ? `, ${a.rejectIds.length} item(s) rejected` : ""}`;
    default:
      return tool;
  }
}

export type ToolOutcome = { content: string; step: Step; proposal?: Proposal };

/**
 * Runs one tool call. An unknown tool, invalid arguments or a failed procedure answer the model with the reason (it
 * may fix the call); nothing throws.
 */
export async function runChatTool(toolCall: ToolCall, context: Context): Promise<ToolOutcome> {
  const def = chatTool(toolCall.name);
  const step: Step = { id: toolCall.id, tool: toolCall.name, title: def?.title ?? toolCall.name, args: plainArgs(toolCall.args), ok: false };
  if (!def) return { content: JSON.stringify({ error: `Unknown tool ${toolCall.name}.` }), step };
  const args = { ...def.defaults, ...toolCall.args };
  if (def.name === "quick_add") args.capturedVia = "joyo";
  const input = toolInput(def);
  if (input) {
    const parsed = input.safeParse(args);
    if (!parsed.success) {
      return { content: JSON.stringify({ error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` }), step };
    }
  }
  if (def.chat === "propose") {
    const id = crypto.randomUUID();
    // A quick add carries the proposal's id as its clientRef: confirming twice (two taps, two tabs) adds one row.
    if (def.name === "quick_add") args.clientRef = `joyo:${id}`;
    const proposal: Proposal = { id, tool: def.name, title: def.title, summary: describeProposal(def.name, args), args, status: "pending" };
    return {
      content: JSON.stringify({ proposed: true, proposalId: proposal.id, shownToMember: proposal.summary, note: "Waiting for the member to confirm. Nothing has been saved." }),
      step: { ...step, ok: true },
      proposal,
    };
  }
  const principal = context.principal;
  if (!principal?.scopes.includes(def.scope)) return { content: JSON.stringify({ error: `This session lacks the "${def.scope}" permission.` }), step };
  try {
    const result = await call(def.procedure() as Parameters<typeof call>[0], args as never, { context: context as never });
    let content = JSON.stringify(result);
    if (content.length > TOOL_RESULT_CHARS) content = `${content.slice(0, TOOL_RESULT_CHARS)}… [cut: narrow the filters or page with cursor]`;
    return { content, step: { ...step, ok: true } };
  } catch (error) {
    return { content: JSON.stringify({ error: errorText(error) }), step };
  }
}

/** Runs a confirmed proposal with exactly its stored arguments. Throws the procedure's error. */
export async function runProposal(proposal: Proposal, context: Context): Promise<unknown> {
  const def = chatTool(proposal.tool);
  if (!def || def.chat !== "propose") throw new ORPCError("BAD_REQUEST", { message: "This change can no longer be made from the chat." });
  if (!context.principal?.scopes.includes(def.scope)) throw new ORPCError("FORBIDDEN", { message: `This session lacks the "${def.scope}" permission.` });
  return call(def.procedure() as Parameters<typeof call>[0], proposal.args as never, { context: context as never });
}

/** What a confirmed write did, in one line for the card. */
export function resultLine(tool: string, result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const tx = (r.transaction ?? null) as Record<string, unknown> | null;
  switch (tool) {
    case "quick_add":
      return tx ? `${r.created === false ? "Already added" : "Added as pending"}: ${String(tx.display ?? "")} · ${String(tx.merchant ?? tx.description ?? "")}` : "Added";
    case "categorize":
      return `${String(r.updated ?? 0)} updated${r.rule ? `, rule saved (${String(r.ruleAppliedToExisting ?? 0)} older ones too)` : ""}`;
    case "create_rule":
      return `Rule saved${typeof r.appliedToExisting === "number" ? `, applied to ${r.appliedToExisting} older transactions` : ""}`;
    case "save_scenario":
      return "Scenario saved; it shows on the Plan page";
    case "mark_reimbursable":
      return r.profileId ? `${String(r.updated ?? 0)} marked reimbursable` : `${String(r.updated ?? 0)} back to ordinary spending`;
    case "set_claim_status": {
      const claim = (r.claim ?? {}) as Record<string, unknown>;
      return `Claim ${String(claim.number ?? "")} is now ${String(claim.status ?? "updated")}`;
    }
    default:
      return "Done";
  }
}
