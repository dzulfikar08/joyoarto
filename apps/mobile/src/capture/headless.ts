import { AppRegistry } from "react-native";

import "./session";
import { syncCaptures } from "./sync";

/**
 * Started by CaptureHeadlessService when an allow-listed notification arrives and the app is not open:
 * drain the native inbox, parse, queue, send. Anything that fails stays queued for the next run.
 */
AppRegistry.registerHeadlessTask("JoyoArtoCapture", () => async () => {
  try {
    await syncCaptures();
  } catch {
    // never crash the background task; the inbox and the queue keep everything
  }
});
