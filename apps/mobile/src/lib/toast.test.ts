import { beforeEach, describe, expect, test } from "bun:test";

import { MAX_VISIBLE, pushToastHost, resetToastsForTest, setToastRenderer, toast, type ToastSpec } from "./toast";

let clock = 0;
let shown: { handle: number; spec: ToastSpec; gone: () => void }[] = [];
let dismissed: (string | number)[] = [];
let handles = 100;

beforeEach(() => {
  clock = 0;
  shown = [];
  dismissed = [];
  resetToastsForTest(() => clock);
  setToastRenderer({
    show(spec, gone) {
      const handle = handles++;
      shown.push({ handle, spec, gone });
      return handle;
    },
    dismiss(handle) {
      dismissed.push(handle);
    },
  });
});

describe("toast", () => {
  test("keeps the API and durations: 3 s, errors 5 s", () => {
    expect(toast.success("Saved", "Rp 25.000")).toBe(1);
    toast.error("Couldn't save");
    toast.show("Kept", { description: "d" });
    expect(shown.map((s) => [s.spec.title, s.spec.tone, s.spec.durationMs, s.spec.description])).toEqual([
      ["Saved", "success", 3000, "Rp 25.000"],
      ["Couldn't save", "error", 5000, undefined],
      ["Kept", "default", 3000, "d"],
    ]);
    expect(shown.every((s) => s.spec.host === undefined)).toBe(true);
  });

  test("at most three per host: the oldest goes", () => {
    for (let i = 0; i < MAX_VISIBLE + 1; i++) toast.success(`t${i}`);
    expect(dismissed).toEqual([shown[0]!.handle]);
  });

  test("dismiss and clear", () => {
    const a = toast.success("a");
    toast.success("b");
    toast.dismiss(a);
    toast.dismiss(a);
    expect(dismissed).toEqual([shown[0]!.handle]);
    toast.clear();
    expect(dismissed).toEqual([shown[0]!.handle, shown[1]!.handle]);
  });

  test("a toast gone by swipe or timer is forgotten", () => {
    const a = toast.success("a");
    shown[0]!.gone();
    toast.dismiss(a);
    expect(dismissed).toEqual([]);
  });

  test("an open sheet takes new toasts; closing it hands them to the root with the time left", () => {
    const release = pushToastHost("sheet-1");
    toast.success("Added as pending");
    expect(shown[0]!.spec.host).toBe("sheet-1");
    clock = 1000;
    release();
    expect(dismissed).toEqual([shown[0]!.handle]);
    expect(shown[1]!.spec).toEqual({ title: "Added as pending", description: undefined, tone: "success", durationMs: 2000, host: undefined });
    // The old handle's late callback doesn't drop the moved toast.
    shown[0]!.gone();
    toast.clear();
    expect(dismissed).toContain(shown[1]!.handle);
  });

  test("nested sheets: the top one wins; an almost expired toast is not moved", () => {
    const outer = pushToastHost("sheet-1");
    const inner = pushToastHost("sheet-2");
    toast.success("inner");
    expect(shown[0]!.spec.host).toBe("sheet-2");
    clock = 2800;
    inner();
    expect(shown).toHaveLength(1);
    toast.success("outer");
    expect(shown[1]!.spec.host).toBe("sheet-1");
    outer();
    expect(shown[2]!.spec.host).toBeUndefined();
  });
});
