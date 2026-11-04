import { describe, expect, test } from "bun:test";

import { classifyJago, cleanGopayName, gopayCategory } from "./classify";
import { isGopayStatement, parseGopay } from "./gopay";
import { isJagoStatement, parseJago } from "./jago";

// Synthetic statements in the layout pdf.js extracts (amount and balance on one line).
const JAGO = `Monthly Statements July 2026 Page 1 of 3
PT Bank Jago Tbk is licensed and supervised by Financial Services Authority (OJK)
BUDI SANTOSO / 500000001234
Main Pocket
Pocket ID 500000001234
Pocket is created on 01 Jan 2022
Previous Balance
Total Incoming
Total Outgoing
Closing Balance
1.000.000,00
+5.000.000,00
-130.000,00
5.870.000,00
Date & Time Source/Destination Transaction Details Notes Amount Balance
02 Jul 2026
07:37
GoPay
0320260702003654ABCDEFGHIJID-
1
Payment with Jago Pay
ID# 260702-AAAA-BBBBBB
004 - Gopay - Generic
Jago payment
-30.000,00 970.000,00
03 Jul 2026
08:00
Jajan
Movement between Pockets
Pocket Money In
ID# 260703-CCCC-DDDDDD
-100.000,00 870.000,00
31 Jul 2026
22:34
ACME CORP
Mandiri 1230000045678
Incoming Transfer
ID# 260731-EEEE-FFFFFF
BI FAST Transfer +5.000.000,00 5.870.000,00
Jajan
Pocket ID 500100005678
Previous Balance
Total Incoming
Total Outgoing
Closing Balance
0,00
+
100.000,00
-
0,00
100.000,00
Date & Time Source/Destination Transaction Details Notes Amount Balance
03 Jul 2026
08:00
Main Pocket
Movement between Pockets
Pocket Money In
ID# 260703-GGGG-HHHHHH
+100.000,00
100.000,00`;

const GOPAY = `gopay E-statement Halaman 1 dari 1 Periode transaksi : 1 Juli 2026 - 31 Juli 2026
Total Coins dipakai
0
Total pemasukan
Rp0
Total pengeluaran
Rp30.000
Tanggal Transaksi ID transaksi Metode pembayaran Jumlah
02/07/2026
07:37
Cashback KOPI KENANGAN QR BRI 1 1 0320260702003700xy2
abcd06eID
GoPay Coins 30
02/07/2026
07:37
KOPI KENANGAN QR BRI 1 1 0320260702003654ABCD
EFGHIJID
Jago -Rp30.000`;

describe("Jago", () => {
  test("pockets, rows, both balance layouts, GoPay reference", () => {
    expect(isJagoStatement(JAGO.replace(/ /g, "\t"))).toBe(true);
    const s = parseJago(JAGO);
    expect(s.problems).toEqual([]);
    expect(s.accountName).toBe("BUDI SANTOSO");
    expect(s.pockets.map((p) => [p.name, p.rows.length, p.closing])).toEqual([
      ["Main Pocket", 3, 587000000],
      ["Jajan", 1, 10000000],
    ]);
    const [pay, move, salary] = s.pockets[0]!.rows;
    expect(pay).toMatchObject({ date: "2026-07-02", amount: -3000000, gopayRef: "0320260702003654ABCDEFGHIJID", ref: "260702-AAAA-BBBBBB" });
    expect(classifyJago(move!, s.accountName).category).toBe("transfer");
    expect(salary!.notes).toEqual(["BI FAST Transfer"]);
  });

  test("a label glued onto the closing balance is split off", () => {
    const glued = JAGO.replace("100.000,00\nDate & Time", "100.000,00Currency In IDR\nDate & Time");
    expect(glued).not.toBe(JAGO);
    const s = parseJago(glued);
    expect(s.problems).toEqual([]);
    expect(s.pockets[1]!.closing).toBe(10000000);
  });

  test("a misread amount is reported", () => {
    const s = parseJago(JAGO.replace("-30.000,00 970.000,00", "-3.000,00 970.000,00"));
    expect(s.problems.length).toBeGreaterThan(0);
  });
});

describe("GoPay", () => {
  test("rows, coins, totals and the id shared with Jago", () => {
    expect(isGopayStatement(GOPAY)).toBe(true);
    const s = parseGopay(GOPAY);
    expect(s.problems).toEqual([]);
    const pay = s.rows.find((r) => r.amount !== null)!;
    expect(pay).toMatchObject({ name: "KOPI KENANGAN QR BRI 1 1", id: "0320260702003654ABCDEFGHIJID", method: "Jago", amount: -3000000 });
    expect(s.rows.find((r) => r.name.startsWith("Cashback"))!.amount).toBeNull();
    expect(cleanGopayName(pay.name)).toBe("Kopi Kenangan");
    expect(gopayCategory(pay.name)).toBe("food/coffee");
    expect(gopayCategory("PECEL ANA BLITAR")).toBe("food/dining");
    expect(gopayCategory("Indomaret")).toBe("food/groceries");
    expect(gopayCategory("KITABISA.COM")).toBe("giving");
    expect(gopayCategory("DISHUB SBY SB14")).toBe("transport/parking-toll");
    expect(gopayCategory("MBL797345*TOKO")).toBe("food/groceries");
  });
});
