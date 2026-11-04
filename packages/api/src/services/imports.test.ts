import { expect, test } from "bun:test";

import { checkBalances } from "./imports";

test("balance check finds a misread sign in either order", () => {
  const oldestFirst = [
    { amount: 0, balanceAfter: 1000 },
    { amount: -200, balanceAfter: 800 },
    { amount: 300, balanceAfter: 500 }, // should have been -300
    { amount: 100, balanceAfter: 600 },
  ];
  const fwd = checkBalances(oldestFirst);
  expect(fwd.order).toBe("oldest_first");
  expect(fwd.mismatches).toEqual([{ row: 2, expected: 1100, printed: 500 }]);
  const back = checkBalances([...oldestFirst].reverse());
  expect(back.order).toBe("newest_first");
  expect(back.mismatches.length).toBe(1);
  expect(checkBalances([{ amount: 1 }, { amount: 2 }]).checked).toBe(0);
});
