import { expect, test } from "bun:test";
import { hostRedirect } from "./hosts";

test("public pages stay on the landing host, app pages move to the app host", () => {
  expect(hostRedirect("arto.joyorogo.com", "/")).toBeNull();
  expect(hostRedirect("arto.joyorogo.com", "/privasi/")).toBeNull();
  expect(hostRedirect("arto.joyorogo.com", "/pricing")).toBeNull();
  expect(hostRedirect("arto.joyorogo.com", "/login", "?redirect=%2F")).toBe("https://app.arto.joyorogo.com/login?redirect=%2F");
  expect(hostRedirect("app.arto.joyorogo.com", "/transactions")).toBeNull();
  expect(hostRedirect("baroka.by.dzulfikar.com", "/")).toBe("https://app.arto.joyorogo.com/");
  expect(hostRedirect("localhost", "/plan")).toBeNull();
});
