import { describe, expect, test } from "bun:test";

import { sampleJagoText } from "./sample";
import { ACCOUNT, MERCHANTS, PERSON, bcaStatement } from "../../test/statements";
import { buildSkeleton, formatFingerprint, guessBank, headerLines, maskLine, shapeOf, verifySkeleton } from "./skeleton";

describe("maskLine", () => {
  test("digits become 9, keeping the shapes", () => {
    expect(maskLine("01/10/2026 13:45 Rp 1.250.000,50")).toBe("99/99/9999 99:99 Rp 9.999.999,99");
  });

  test("vocabulary stays, other words become fixed-length shapes by case", () => {
    expect(maskLine("TRSF E-BANKING DB QRIS SURYANINGSIH Kopikenangan warung McDonald")).toBe("TRSF E-BANKING DB QRIS XXXX Xxxx xxxx XxXx");
    expect(maskLine("Saldo Awal Opening Balance Oktober Okt BCA Mandiri")).toBe("Saldo Awal Opening Balance Oktober Okt BCA Mandiri");
    expect(shapeOf("A")).toBe("XXXX");
    // Single letters are kept (D/K markers); an initial at most.
    expect(maskLine("D K C")).toBe("D K C");
  });
});

describe("buildSkeleton", () => {
  const text = bcaStatement(40);
  const sk = buildSkeleton(text);

  test("nothing of the member's survives", () => {
    for (const secret of [...PERSON, ACCOUNT, ...MERCHANTS.flatMap((m) => m.split(" ")), "KENANGA", "MALANG", "BUDI", "HARTONO", "4.512.300", "15.277.733", "FTSCY", "WS95031"]) {
      expect(sk.text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(sk.text).not.toMatch(/[0-8]/);
  });

  test("keeps the format: labels, date and amount shapes, debit/credit markers", () => {
    expect(sk.text).toContain("TANGGAL KETERANGAN XXXX MUTASI SALDO");
    expect(sk.text).toContain("99/99 SALDO AWAL 9.999.999,99");
    expect(sk.text).toContain("99/99 TRSF E-BANKING DB 9999/XXXX/XXXX99999");
    expect(sk.text).toContain("99.999,99 DB 9.999.999,99");
    expect(sk.text).toContain("SALDO AKHIR : 99.999.999,99");
    expect(sk.text).toContain("XXXX XXXX                      NO. REKENING : 9999999999");
    expect(sk.lines).toBe(text.split("\n").length);
    expect(sk.pages).toBe(2);
    expect(sk.bank).toBeNull();
  });

  test("passes verification", () => {
    expect(verifySkeleton(text, sk.text)).toEqual({ ok: true });
  });

  test("a tampered skeleton fails verification", () => {
    expect(verifySkeleton(text, sk.text.replace("9999999999", ACCOUNT)).ok).toBe(false);
    expect(verifySkeleton(text, sk.text.replace("XXXX XXXX", "SURYANINGSIH XXXX"))).toEqual({ ok: false, reason: "an unmasked word" });
    expect(verifySkeleton(text, `${sk.text}\nXXXX 9`)).toEqual({ ok: true });
    // A real word that happens to be cased like a mask is not a mask.
    expect(verifySkeleton(text, `${sk.text}\nAlfamart`).ok).toBe(false);
    // Notes cannot smuggle digits in the middle of a line.
    expect(verifySkeleton(text, `99 ⟨×12⟩ 99`).ok).toBe(false);
  });

  test("identical lines collapse, and the output is capped with the header and footer kept", () => {
    const many = buildSkeleton(["HEADER SALDO", ...Array.from({ length: 5 }, () => "99/99 TRSF"), "SALDO AKHIR"].join("\n"));
    expect(many.text).toBe("XXXX SALDO\n99/99 TRSF ⟨×5⟩\nSALDO AKHIR");

    const long = bcaStatement(900);
    const capped = buildSkeleton(long);
    expect(capped.skeletonLines).toBeLessThanOrEqual(200);
    expect(capped.text.length).toBeLessThanOrEqual(15_000);
    expect(capped.text.split("\n")[0]).toBe("REKENING XXXX");
    expect(capped.text).toContain("SALDO AKHIR : 99.999.999,99");
    expect(capped.text).toMatch(/⟨… \d+ lines omitted …⟩/);
    expect(verifySkeleton(long, capped.text)).toEqual({ ok: true });
  });
});

describe("formatFingerprint", () => {
  test("same format, different person, rows and month: same fingerprint", async () => {
    const a = buildSkeleton(bcaStatement(12));
    const b = buildSkeleton(bcaStatement(57, { holder: "AGUS SANTOSO", account: "1234567890", month: "NOVEMBER 2026" }));
    expect(await formatFingerprint(a.text)).toBe(await formatFingerprint(b.text));
    expect(await formatFingerprint(a.text)).toMatch(/^stmt-[0-9a-f]{16}$/);
    expect(headerLines(a.text)).toEqual(["rekening", "no. rekening : 9", "halaman : 9 / 9", "periode : M 9", "mata uang : idr", "tanggal keterangan mutasi saldo"]);
  });

  test("another layout: another fingerprint", async () => {
    const a = buildSkeleton(bcaStatement(12));
    const jago = buildSkeleton(sampleJagoText());
    expect(await formatFingerprint(a.text)).not.toBe(await formatFingerprint(jago.text));
    expect(jago.bank).toBe("Jago");
    expect(verifySkeleton(sampleJagoText(), jago.text)).toEqual({ ok: true });
    expect(jago.text).not.toContain("RINA");
  });
});

describe("guessBank", () => {
  test("names in the first lines count more", () => {
    expect(guessBank(["PT Bank Mandiri (Persero) Tbk", "Rekening Koran", "TRSF BCA", "TRSF BCA", "TRSF BCA"])).toBe("BCA");
    expect(guessBank(["PT Bank Mandiri (Persero) Tbk", ...Array.from({ length: 20 }, () => "x"), "TRSF BCA"])).toBe("Mandiri");
    expect(guessBank(["XXXX"])).toBeNull();
  });
});

test("bank names that are also given names are masked", () => {
  const text = "NAMA : MEGA DANA PRIMA\nTRSF E-BANKING CR NEO ALLO\nTOP UP DANA 50.000";
  const sk = buildSkeleton(text);
  for (const name of ["MEGA", "DANA", "PRIMA", "NEO", "ALLO"]) expect(sk.text).not.toContain(name);
  expect(verifySkeleton(text, sk.text)).toEqual({ ok: true });
});
