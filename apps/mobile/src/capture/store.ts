import { jsonFile } from "../lib/json-file";
import { observable, useObservable } from "../lib/observable";
import type { CaptureItem } from "./queue";

const file = jsonFile<{ version: 1; items: CaptureItem[] }>("captures.json");
const store = observable<CaptureItem[]>([]);
let loaded: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function loadCaptures() {
  loaded ??= file.read().then((doc) => {
    // An item left "sending" by a killed process goes back to the queue (clientRef makes the resend safe).
    store.set((doc?.items ?? []).map((i) => (i.status === "sending" ? { ...i, status: "queued" } : i)));
  });
  return loaded;
}

/** Serialised read-modify-write, shared by the UI and the headless task (same JS runtime). */
export function mutateCaptures(fn: (items: CaptureItem[]) => CaptureItem[]): Promise<CaptureItem[]> {
  const run = chain.then(async () => {
    await loadCaptures();
    const next = fn(store.get());
    store.set(next);
    file.write({ version: 1, items: next });
    return next;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function updateCapture(id: string, fn: (item: CaptureItem) => CaptureItem) {
  return mutateCaptures((items) => items.map((i) => (i.id === id ? fn(i) : i)));
}

export function getCaptures() {
  return store.get();
}

export function useCaptures() {
  return useObservable(store);
}
