import { expect, test } from "bun:test";

import { signupOpen } from "./index";

test("OPEN_SIGNUP opens sign-up only for 1 or true", () => {
  for (const v of ["1", "true", "TRUE", " true "]) expect(signupOpen({ OPEN_SIGNUP: v })).toBe(true);
  for (const v of [undefined, "", "0", "false", "no", "yes"]) expect(signupOpen({ OPEN_SIGNUP: v })).toBe(false);
});
