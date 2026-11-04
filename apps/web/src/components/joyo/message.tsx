// One chat turn, after JoyoRogo's components/joyo/message.tsx and steps.tsx: the member's bubble, Joyo's answer as
// markdown with the tools it read, and the changes it proposed as cards with Confirm and Dismiss.

import type { Proposal, Step } from "@baroka/api/lib/joyo-ai/tools";
import { Button } from "@baroka/ui/components/button";
import { cn } from "@baroka/ui/lib/utils";
import { Check, ChevronDown, CircleAlert, Loader2, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { JoyoMarkdown as Markdown } from "./markdown";

const TOOL_WORDS: Record<string, string> = {
  list_accounts: "Accounts and balances",
  list_categories: "Categories",
  search_transactions: "Transactions",
  spending_summary: "Spending summary",
  cashflow: "Monthly cashflow",
  month_dashboard: "Month overview",
  budget_status: "Budgets",
  plan_baseline: "Planning baseline",
  plan_templates: "Plan templates",
  simulate_plan: "Simulation",
  compare_plans: "Plan comparison",
  list_scenarios: "Saved scenarios",
  household_info: "Household",
  list_rules: "Rules",
  list_imports: "Imports",
  quick_add: "Proposed: add",
  categorize: "Proposed: categorise",
  update_transaction: "Proposed: edit",
  create_rule: "Proposed: rule",
  set_budget: "Proposed: budget",
  save_scenario: "Proposed: save scenario",
};

export const toolWords = (tool: string) => TOOL_WORDS[tool] ?? tool;

function argLine(args: Step["args"]): string {
  return Object.entries(args)
    .filter(([k]) => k !== "cursor")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export function Steps({ steps, running }: { steps: readonly (Step & { running?: boolean })[]; running?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const busy = running && steps.some((s) => s.running);
  return (
    <div className="text-xs text-muted-foreground">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 rounded-full py-1 font-semibold hover:text-foreground">
        {busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
        {busy ? `Reading ${toolWords(steps.at(-1)!.tool).toLowerCase()}…` : `Read ${steps.length} ${steps.length === 1 ? "source" : "sources"}`}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="mt-1 space-y-1 border-l-2 border-border pl-3">
          {steps.map((s) => (
            <li key={s.id} className="flex flex-wrap gap-x-2">
              <span className={cn("font-semibold", !s.ok && !s.running && "text-destructive")}>{toolWords(s.tool)}</span>
              {argLine(s.args) && <span className="truncate">{argLine(s.args)}</span>}
              {!s.ok && !s.running && <span>(failed)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProposalCard({ proposal, onAct, busy }: { proposal: Proposal; onAct?: (action: "confirm" | "dismiss") => void; busy?: boolean }) {
  const pending = proposal.status === "pending";
  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5 text-sm",
        proposal.status === "done" ? "border-positive/30 bg-positive-soft" : proposal.status === "failed" ? "border-destructive/30 bg-destructive-soft" : "border-border bg-card",
      )}
    >
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{proposal.title}</p>
      <p className="mt-1 font-semibold break-words">{proposal.summary}</p>
      {proposal.result && (
        <p className={cn("mt-1 text-xs", proposal.status === "failed" ? "text-destructive-ink" : "text-positive-ink")}>
          {proposal.status === "failed" && <CircleAlert className="mr-1 inline size-3.5" aria-hidden />}
          {proposal.result}
        </p>
      )}
      {proposal.status === "dismissed" && <p className="mt-1 text-xs text-muted-foreground">Dismissed</p>}
      {pending && onAct && (
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => onAct("confirm")}>
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check aria-hidden />} Confirm
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onAct("dismiss")}>
            <X aria-hidden /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-[0.9375rem] whitespace-pre-wrap text-primary-foreground">{text}</p>
    </div>
  );
}

export function AssistantTurn({
  text,
  steps,
  proposals,
  streaming,
  onProposal,
  busyProposal,
}: {
  text: string;
  steps: readonly (Step & { running?: boolean })[];
  proposals: readonly Proposal[];
  streaming?: boolean;
  onProposal?: (proposal: Proposal, action: "confirm" | "dismiss") => void;
  busyProposal?: string | null;
}) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-ink">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <Steps steps={steps} running={streaming} />
        {text ? (
          <Markdown text={text} streaming={streaming} />
        ) : streaming ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Thinking…
          </p>
        ) : null}
        {proposals.length > 0 && (
          <div className="space-y-2">
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} busy={busyProposal === p.id} {...(onProposal ? { onAct: (a: "confirm" | "dismiss") => onProposal(p, a) } : {})} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
