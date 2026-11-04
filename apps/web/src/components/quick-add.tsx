import { parseAmountText } from "@baroka/api/lib/amount-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@baroka/ui/components/button";
import { Card } from "@baroka/ui/components/card";
import { Input } from "@baroka/ui/components/input";
import { Combobox } from "@baroka/ui/components/combobox";
import { ChevronDown, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { formatMoney } from "@/lib/format";
import { accountOptions, categoryOptions } from "@/lib/options";
import { openAddSheet } from "@/lib/add-sheet";
import { client, errorMessage, orpc } from "@/lib/orpc";

export const ACCOUNT_KEY = "baroka.quickAdd.account";

export function storedAccount(): string {
  try {
    return localStorage.getItem(ACCOUNT_KEY) ?? "";
  } catch {
    return "";
  }
}

export type QuickAddInput = Parameters<typeof client.transactions.quickAdd>[0];

/**
 * Saves a capture as a pending transaction: the toast, and the queries that show it. Shared by this box and the add
 * sheet (components/add-sheet.tsx). `onSaved` runs after a success.
 */
export function useSaveQuickAdd(onSaved?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickAddInput) => client.transactions.quickAdd(input),
    onSuccess: (res) => {
      const t = res.transaction;
      toast.success(`${res.created ? "Added" : "Already added"} as pending`, { description: `${t.display} · ${t.merchant ?? t.description} · ${t.account}` });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: orpc.reports.key() });
      void qc.invalidateQueries({ queryKey: orpc.accounts.key() });
      onSaved?.();
    },
    onError: (err) => toast.error("Couldn't add it", { description: errorMessage(err) }),
  });
}

/**
 * Type "25rb kopi" style captures as they happen. They are saved as pending and the next statement import of that
 * account confirms them. A retry of the same submit reuses its clientRef, so a flaky connection adds nothing twice.
 */
export function QuickAdd({ title = "Quick add", collapsible = false }: { title?: string; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: {} }));
  const categories = useQuery(orpc.categories.list.queryOptions());
  const [amountText, setAmountText] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(storedAccount);
  const [category, setCategory] = useState("");
  const clientRef = useRef(crypto.randomUUID());

  const list = accounts.data?.accounts ?? [];
  const accountItems = useMemo(() => accountOptions((accounts.data?.accounts ?? []).filter((a) => !a.archived)), [accounts.data]);
  const catItems = useMemo(() => categoryOptions(categories.data?.categories ?? []), [categories.data]);
  const account = list.find((a) => a.id === accountId);
  const currency = account?.currency ?? "IDR";
  const parsed = useMemo(() => {
    if (!amountText.trim()) return null;
    try {
      return parseAmountText(amountText, currency);
    } catch {
      return "invalid" as const;
    }
  }, [amountText, currency]);
  const sign = parsed && parsed !== "invalid" ? (parsed.sign ?? (direction === "in" ? 1 : -1)) : -1;

  const save = useSaveQuickAdd(() => {
    setAmountText("");
    setDescription("");
    setCategory("");
    setDirection("out");
    clientRef.current = crypto.randomUUID();
  });
  const add = {
    isPending: save.isPending,
    mutate: () =>
      save.mutate({
        amountText,
        ...(parsed && parsed !== "invalid" && parsed.sign === null ? { direction } : {}),
        description: description.trim(),
        ...(accountId ? { accountId } : {}),
        ...(category ? { category } : {}),
        capturedVia: "manual",
        clientRef: clientRef.current,
      }),
  };

  const pickAccount = (id: string) => {
    setAccountId(id);
    try {
      if (id) localStorage.setItem(ACCOUNT_KEY, id);
      else localStorage.removeItem(ACCOUNT_KEY);
    } catch {
      // Private mode: the choice just is not remembered.
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  const ready = parsed && parsed !== "invalid" && description.trim() && !add.isPending;
  if (accounts.isSuccess && !list.length) return null;

  if (!open)
    return (
      // Collapsed: one tappable card. Phones open the add sheet (type or say it); wider screens unfold the form here.
      <button
        type="button"
        aria-expanded={false}
        onClick={() => (window.matchMedia("(min-width: 640px)").matches ? setOpen(true) : openAddSheet())}
        className="card flex w-full items-center gap-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-ink">
          <Plus className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">Type or say it: “kopi 25rb gopay”. Pending until the statement confirms it.</span>
        </span>
        <ChevronDown className="hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden />
      </button>
    );

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        <span className="text-xs text-muted-foreground">Pending until the statement confirms it</span>
        {collapsible && (
          <button type="button" className="ml-auto text-sm font-semibold text-primary hover:underline" aria-expanded onClick={() => setOpen(false)}>
            Hide
          </button>
        )}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="inline-flex h-10 rounded-full bg-muted p-1 text-sm" role="group" aria-label="Direction">
          {(["out", "in"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={direction === d}
              className={`rounded-full px-3.5 font-semibold transition-colors ${direction === d ? "bg-segment text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setDirection(d)}
            >
              {d === "out" ? "Spent" : "Received"}
            </button>
          ))}
        </div>
        <Input
          className="h-10 min-w-0 rounded-xl px-3 sm:w-36 sm:text-sm"
          inputMode="text"
          placeholder="25rb, Rp 25.000"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          autoComplete="off"
          enterKeyHint="next"
          aria-label="Amount"
        />
        <Input
          className="col-span-2 h-10 min-w-0 rounded-xl px-3 sm:w-auto sm:min-w-48 sm:flex-1 sm:text-sm"
          placeholder="What was it? (kopi kenangan)"
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          enterKeyHint="done"
          aria-label="Description"
        />
        <Combobox
          size="sm"
          className="col-span-2 sm:col-span-1 sm:w-48"
          value={accountId}
          onValueChange={pickAccount}
          aria-label="Account"
          none="Most used account"
          items={accountItems}
          searchPlaceholder="Search accounts"
        />
        <Combobox
          size="sm"
          className="col-span-2 sm:col-span-1 sm:w-52"
          value={category}
          onValueChange={setCategory}
          aria-label="Category"
          none="Category: rules decide"
          items={catItems}
          searchPlaceholder="Search categories"
        />
        <Button type="submit" size="sm" className="col-span-2 sm:ml-auto sm:px-6" disabled={!ready}>
          {add.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground empty:hidden" aria-live="polite">
        {parsed === "invalid"
          ? "Can't read that amount. Try 25rb, 25.000 or 1,5jt."
          : parsed
            ? `${formatMoney(sign * parsed.amount, currency)}${parsed.sign !== null ? " (sign from the text)" : ""}`
            : null}
      </p>
      </form>
    </Card>
  );
}
