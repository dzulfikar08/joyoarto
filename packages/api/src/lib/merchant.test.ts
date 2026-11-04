import { expect, test } from "bun:test";

import { cleanMerchant } from "./merchant";

test.each([
  ["TRSF E-BANKING DB 0303/FTSCY/WS95051 25000.00 INDOMARET CABANG", "Indomaret"],
  ["QRIS PAYMENT KOPI TUKU CIPETE 12345678", "Kopi Tuku Cipete"],
  ["GOPAY TOPUP 0812xxxx", "Gojek"],
  ["KARTU DEBIT 0303 SUPERINDO KEMANG", "Superindo Kemang"],
  ["BI-FAST DB TRANSFER KE BUDI SANTOSO", "Budi Santoso"],
  ["Shopee*Order 2093", "Shopee"],
  ["0303/0303 12345", null],
  ["TRSF E-BANKING DB 2410/FTSCY/WS95031 BUDI SANTOSO", "Budi Santoso"],
])("%s -> %s", (raw, expected) => {
  expect(cleanMerchant(raw)).toBe(expected);
});
