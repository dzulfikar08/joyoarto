import { Redirect } from "expo-router";
import { useEffect } from "react";

import { openAddSheet } from "@/src/lib/add-sheet";

/** The centre slot of the tab bar. A deep link to /add opens the add sheet over Home. */
export default function AddRoute() {
  useEffect(() => openAddSheet(), []);
  return <Redirect href="/" />;
}
