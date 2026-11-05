import { describe, expect, test } from "bun:test";

import { otaLabel } from "./ota";

describe("otaLabel", () => {
  test("nothing in dev clients and on the web", () => {
    expect(otaLabel({ enabled: false, isEmbeddedLaunch: true })).toBeNull();
  });

  test("the bundle inside the binary", () => {
    expect(otaLabel({ enabled: true, isEmbeddedLaunch: true, channel: "production", runtimeVersion: "113a4f54ccf13772" })).toBe(
      "built-in · production · runtime 113a4f54",
    );
  });

  test("a downloaded update", () => {
    expect(
      otaLabel({ enabled: true, isEmbeddedLaunch: false, updateId: "0193f6a2-7c1e-7b5e-9a10-5f2d3c4b5a69", channel: "preview", runtimeVersion: "1742ce7f985fb162" }),
    ).toBe("update 0193f6a2 · preview · runtime 1742ce7f");
  });

  test("an emergency launch runs the built-in bundle", () => {
    expect(otaLabel({ enabled: true, isEmbeddedLaunch: false, isEmergencyLaunch: true, updateId: "0193f6a2-7c1e" })).toBe("built-in");
  });
});
