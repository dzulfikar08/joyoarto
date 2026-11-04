// Toasts: short confirmations and errors that don't need a tap ("Saved as pending", "Couldn't save"). Any code can
// call toast.success(...); components/ui/toast.tsx draws them above the tab bar. Pure store.

import { observable } from "./observable";

export type ToastTone = "default" | "success" | "error";
export type ToastItem = { id: number; title: string; description?: string; tone: ToastTone; durationMs: number };

const items = observable<ToastItem[]>([]);
let nextId = 1;

function show(title: string, opts: { description?: string; tone?: ToastTone; durationMs?: number } = {}): number {
  const item: ToastItem = { id: nextId++, title, description: opts.description, tone: opts.tone ?? "default", durationMs: opts.durationMs ?? (opts.tone === "error" ? 5000 : 3000) };
  // At most three at once; the oldest goes.
  items.set([...items.get(), item].slice(-3));
  return item.id;
}

export const toast = {
  show,
  success: (title: string, description?: string) => show(title, { description, tone: "success" }),
  error: (title: string, description?: string) => show(title, { description, tone: "error" }),
  dismiss(id: number) {
    items.set(items.get().filter((t) => t.id !== id));
  },
  clear() {
    items.set([]);
  },
  store: items,
};
