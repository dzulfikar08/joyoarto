import { expect, test } from "bun:test";

import { isAnthropicEgress } from "./anthropic-egress";

test("only 160.79.104.0/21 counts as Anthropic's egress", () => {
  for (const ip of ["160.79.104.0", "160.79.104.17", "160.79.111.255"]) expect(isAnthropicEgress(ip)).toBe(true);
  for (const ip of ["160.79.103.255", "160.79.112.0", "10.0.0.1", "unknown", "2001:db8::1", "160.79.104.256", ""]) expect(isAnthropicEgress(ip)).toBe(false);
});
