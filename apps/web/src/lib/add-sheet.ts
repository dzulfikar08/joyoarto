import { useSyncExternalStore } from "react";

// Whether the add-transaction sheet is open. One sheet for the whole app: the bottom nav's centre button, the desktop
// "Add" button and the dashboard all open the same one.

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}

export const openAddSheet = () => set(true);
export const setAddSheetOpen = set;

export function useAddSheetOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => false,
  );
}
