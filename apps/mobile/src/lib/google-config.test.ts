import { expect, test } from "bun:test";

import { googleConfigFrom, googleConfigured, reversedClientId } from "./google-config";

test("reads the client ids from extra", () => {
  expect(googleConfigFrom({ googleWebClientId: " web ", googleIosClientId: 3 })).toEqual({ webClientId: "web", iosClientId: "" });
  expect(googleConfigFrom(undefined)).toEqual({ webClientId: "", iosClientId: "" });
});

test("iOS needs its own client id; Android only the web one", () => {
  expect(googleConfigured({ webClientId: "w", iosClientId: "" }, "android")).toBe(true);
  expect(googleConfigured({ webClientId: "w", iosClientId: "" }, "ios")).toBe(false);
  expect(googleConfigured({ webClientId: "w", iosClientId: "i" }, "ios")).toBe(true);
  expect(googleConfigured({ webClientId: "", iosClientId: "i" }, "ios")).toBe(false);
  expect(googleConfigured({ webClientId: "w", iosClientId: "i" }, "web")).toBe(false);
});

test("reversed client id is the iOS URL scheme", () => {
  expect(reversedClientId("123-abc.apps.googleusercontent.com")).toBe("com.googleusercontent.apps.123-abc");
});
