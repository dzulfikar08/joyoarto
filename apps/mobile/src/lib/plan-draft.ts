// The Plan page's unsaved draft on this phone (the web keeps it in localStorage): a JSON file in the app's private
// documents, tagged with the household it belongs to, written a moment after each change and deleted at sign-out.
// Scenarios the household wants to keep are saved on the server (plan.scenarios). Shape and checks: ./plan-state.ts.

import { onSessionChange } from "./auth";
import { jsonFile } from "./json-file";
import { draftFor, EMPTY_PLAN, type PlanDraft, type PlanState } from "./plan-state";

const file = jsonFile<PlanDraft>("plan-draft.json");
let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadPlanDraft(householdId: string | null | undefined): Promise<PlanState> {
  return draftFor(await file.read(), householdId);
}

/** Debounced: typing in a field writes once it pauses. */
export function savePlanDraft(householdId: string | null | undefined, state: PlanState) {
  if (!householdId) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      if (state === EMPTY_PLAN) file.remove();
      else file.write({ v: 1, householdId, state });
    } catch {
      // A full disk: the plan still works for this visit.
    }
  }, 500);
}

onSessionChange({
  signOut: () => {
    clearTimeout(timer);
    file.remove();
  },
});
