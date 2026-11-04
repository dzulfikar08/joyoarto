// Whether the add-transaction sheet is open. One sheet for the whole app (like the web's apps/web/src/lib/add-sheet.ts):
// the tab bar's centre button, the Home quick-add card and empty states all open it. `prefill` seeds the text box.

import { observable, useObservable } from "./observable";

export type AddSheetState = { open: boolean; prefill?: string; session: number };

const store = observable<AddSheetState>({ open: false, session: 0 });

export function openAddSheet(prefill?: string) {
  const s = store.get();
  // A new session each time it opens: no draft lingers from last time.
  store.set({ open: true, prefill, session: s.session + 1 });
}

export function closeAddSheet() {
  store.set({ ...store.get(), open: false, prefill: undefined });
}

export function useAddSheet(): AddSheetState {
  return useObservable(store);
}
