// Light / dark / follow the system, chosen on the More page. Kept in its own small file (not settings.json, which the
// headless capture task reads) and applied through Unistyles.

import { UnistylesRuntime } from "react-native-unistyles";

import { jsonFile } from "./json-file";
import { observable, useObservable } from "./observable";

export type Appearance = "system" | "light" | "dark";

const file = jsonFile<{ appearance: Appearance }>("appearance.json");
const store = observable<Appearance>("system");

function apply(a: Appearance) {
  if (a === "system") {
    UnistylesRuntime.setAdaptiveThemes(true);
  } else {
    UnistylesRuntime.setAdaptiveThemes(false);
    UnistylesRuntime.setTheme(a);
  }
}

export async function loadAppearance() {
  const saved = await file.read();
  const a = saved?.appearance === "light" || saved?.appearance === "dark" ? saved.appearance : "system";
  store.set(a);
  apply(a);
}

export function setAppearance(a: Appearance) {
  store.set(a);
  apply(a);
  file.write({ appearance: a });
}

export function useAppearance(): Appearance {
  return useObservable(store);
}
