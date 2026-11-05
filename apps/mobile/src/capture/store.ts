import { jsonFile } from "../lib/json-file";
import { observable, useObservable } from "../lib/observable";
import type { CaptureItem } from "./queue";

/** owner: the user id the captures belong to (they are sent to that account only). */
type Doc = { version: 1; items: CaptureItem[]; owner?: string };

const file = jsonFile<Doc>("captures.json");
const store = observable<CaptureItem[]>([]);
let owner: string | undefined;
let loaded: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function loadCaptures() {
  loaded ??= file.read().then((doc) => {
    owner = doc?.owner;
    // An item left "sending" by a killed process goes back to the queue (clientRef makes the resend safe).
    store.set((doc?.items ?? []).map((i) => (i.status === "sending" ? { ...i, status: "queued" } : i)));
  });
  return loaded;
}

/** Runs fn after every earlier read or write of the queue (the UI and the headless task share one JS runtime). */
function serial<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    await loadCaptures();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

/** Serialised read-modify-write, shared by the UI and the headless task. */
export function mutateCaptures(fn: (items: CaptureItem[]) => CaptureItem[]): Promise<CaptureItem[]> {
  return serial(() => {
    const next = fn(store.get());
    store.set(next);
    file.write({ version: 1, items: next, owner });
    return next;
  });
}

export function updateCapture(id: string, fn: (item: CaptureItem) => CaptureItem) {
  return mutateCaptures((items) => items.map((i) => (i.id === id ? fn(i) : i)));
}

/** Who the stored captures belong to; undefined for a fresh queue or one from before owners were kept. */
export async function capturesOwner() {
  await loadCaptures();
  return owner;
}

/** Records the account the queue belongs to. */
export function setCapturesOwner(userId: string | undefined): Promise<void> {
  return serial(() => {
    owner = userId;
    file.write({ version: 1, items: store.get(), owner });
  });
}

/** Deletes every capture (the raw notification text included) and the file. */
export function clearCaptures(): Promise<void> {
  return serial(() => {
    owner = undefined;
    store.set([]);
    file.remove();
  });
}

export function getCaptures() {
  return store.get();
}

export function useCaptures() {
  return useObservable(store);
}
