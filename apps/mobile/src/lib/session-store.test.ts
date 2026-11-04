import { expect, test } from "bun:test";

import { createSessionStore, KEYS, kindOf, memoryStorage, type Me } from "./session-store";

const me: Me = { user: { id: "u", name: "Ani", email: "ani@example.com" }, household: { id: "h", name: "Rumah", baseCurrency: "IDR" }, scopes: ["finance:read"], via: "session" };

test("kindOf tells personal access tokens from session tokens", () => {
  expect(kindOf("brk_abc")).toBe("token");
  expect(kindOf("abc.def")).toBe("session");
});

test("save, reload, update and clear", async () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage, "https://default");
  expect(await store.load()).toBeNull();
  await store.save({ server: "https://s", token: " tok.sig ", kind: "session", me });
  expect(storage.data[KEYS.token]).toBe("tok.sig");
  expect(storage.data[KEYS.kind]).toBe("session");

  const again = createSessionStore(storage, "https://default");
  expect(await again.load()).toEqual({ server: "https://s", token: "tok.sig", kind: "session", me });

  await again.updateMe({ ...me, household: { ...me.household, name: "Baru" } });
  expect(JSON.parse(storage.data[KEYS.me]!).household.name).toBe("Baru");

  await again.clear();
  expect(again.get()).toBeNull();
  expect(storage.data[KEYS.token]).toBeUndefined();
  // The server address stays for the next sign-in.
  expect(storage.data[KEYS.server]).toBe("https://s");
});

test("an install from before sign-in kinds reads its brk_ token as a token, with the default server", async () => {
  const store = createSessionStore(memoryStorage({ [KEYS.token]: "brk_old", [KEYS.me]: "not json" }), "https://default");
  expect(await store.load()).toEqual({ token: "brk_old", server: "https://default", kind: "token", me: null });
});

test("load runs once; a sign-in during or after it wins", async () => {
  const storage = memoryStorage({ [KEYS.token]: "brk_old" });
  const store = createSessionStore(storage, "https://d");
  const pending = store.load();
  const saving = store.save({ server: "https://d", token: "new.tok", kind: "session", me: null });
  await Promise.all([pending, saving]);
  expect(store.get()?.token).toBe("new.tok");
  expect((await store.load())?.token).toBe("new.tok");
});
