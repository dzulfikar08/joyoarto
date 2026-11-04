import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "bun:test";

import { findTransaction, rememberTransaction, type Tx } from "./tx-cache";

const tx = (id: string, merchant: string) => ({ id, merchant }) as unknown as Tx;

test("prefers a loaded page, falls back to the handed-over row", () => {
  const qc = new QueryClient();
  rememberTransaction(tx("a", "old"));
  expect(findTransaction(qc, [["transactions"]], "a")?.merchant).toBe("old");
  qc.setQueryData([["transactions", "search"], { type: "infinite" }], { pages: [{ transactions: [tx("a", "fresh")] }], pageParams: [undefined] });
  expect(findTransaction(qc, [["transactions"]], "a")?.merchant).toBe("fresh");
  expect(findTransaction(qc, [["transactions"]], "zzz")).toBeNull();
});
