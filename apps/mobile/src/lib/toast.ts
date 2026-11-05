// Toasts: short confirmations and errors that don't need a tap ("Added as pending", "Couldn't save"). Any code can
// call toast.success(...). Pure routing: components/ui/toaster.tsx draws them with sonner-native and registers itself
// as the renderer.
//
// Hosts: the root <AppToaster /> is the default host. An Android Sheet is a native Modal (its own window), so an open
// sheet pushes a host of its own (a named sonner-native Toaster inside the Modal) and new toasts go to the topmost one.
// When that sheet closes, its toasts that are still showing move to the host below with the time they had left, so
// "Added as pending" fired just before the sheet closes stays on screen.

export type ToastTone = "default" | "success" | "error";
export type ToastSpec = { title: string; description?: string; tone: ToastTone; durationMs: number; /** undefined = the root host. */ host?: string };
export type ToastHandle = string | number;
export type ToastRenderer = {
  /** Draws a toast; `onGone` runs when it is dismissed (swipe, tap, timer). Returns the renderer's handle. */
  show(spec: ToastSpec, onGone: () => void): ToastHandle;
  dismiss(handle: ToastHandle): void;
};

/** At most this many per host; a fourth pushes out the oldest. */
export const MAX_VISIBLE = 3;
/** A toast with less than this left is not moved to the next host when its sheet closes. */
const MIN_HANDOFF_MS = 600;

type Live = { spec: ToastSpec; handle: ToastHandle; expiresAt: number };

let renderer: ToastRenderer | null = null;
let now = () => Date.now();
const hosts: string[] = [];
const live = new Map<number, Live>();
let nextId = 1;

export function durationFor(tone: ToastTone): number {
  return tone === "error" ? 5000 : 3000;
}

function draw(id: number, spec: ToastSpec) {
  if (!renderer) return;
  const onHost = [...live].filter(([, t]) => t.spec.host === spec.host);
  for (const [oldId, t] of onHost.slice(0, Math.max(0, onHost.length - (MAX_VISIBLE - 1)))) {
    live.delete(oldId);
    renderer.dismiss(t.handle);
  }
  const entry: Live = { spec, handle: 0, expiresAt: now() + spec.durationMs };
  live.set(id, entry);
  entry.handle = renderer.show(spec, () => {
    // Only if this handle is still the toast's current one (a handoff replaces it).
    if (live.get(id) === entry) live.delete(id);
  });
}

function show(title: string, opts: { description?: string; tone?: ToastTone; durationMs?: number } = {}): number {
  const tone = opts.tone ?? "default";
  const id = nextId++;
  draw(id, { title, description: opts.description, tone, durationMs: opts.durationMs ?? durationFor(tone), host: hosts.at(-1) });
  return id;
}

export const toast = {
  show,
  success: (title: string, description?: string) => show(title, { description, tone: "success" }),
  error: (title: string, description?: string) => show(title, { description, tone: "error" }),
  dismiss(id: number) {
    const t = live.get(id);
    if (!t) return;
    live.delete(id);
    renderer?.dismiss(t.handle);
  },
  clear() {
    for (const id of live.keys()) toast.dismiss(id);
  },
};

/** components/ui/toaster.tsx: the sonner-native binding. */
export function setToastRenderer(r: ToastRenderer | null) {
  renderer = r;
}

/**
 * An extra host on top (an open Android sheet). Returns the release: the host leaves the stack and its toasts that
 * still have time left are shown again on the host below.
 */
export function pushToastHost(host: string): () => void {
  hosts.push(host);
  return () => {
    const i = hosts.lastIndexOf(host);
    if (i < 0) return;
    hosts.splice(i, 1);
    const moving = [...live].filter(([, t]) => t.spec.host === host);
    for (const [id, t] of moving) {
      live.delete(id);
      renderer?.dismiss(t.handle);
      const left = t.expiresAt - now();
      if (left >= MIN_HANDOFF_MS) draw(id, { ...t.spec, durationMs: left, host: hosts.at(-1) });
    }
  };
}

/** Tests only. */
export function resetToastsForTest(clock?: () => number) {
  renderer = null;
  hosts.length = 0;
  live.clear();
  nextId = 1;
  now = clock ?? (() => Date.now());
}
