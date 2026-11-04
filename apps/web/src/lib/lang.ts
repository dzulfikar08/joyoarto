import { useSyncExternalStore } from "react";

/** Public pages (landing, demo) speak Bahasa Indonesia first, English on request (?lang=en or the toggle). */
export type Lang = "id" | "en";

const KEY = "baroka.lang";
const listeners = new Set<() => void>();

function read(): Lang {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "en" || q === "id") return q;
  try {
    return localStorage.getItem(KEY) === "en" ? "en" : "id";
  } catch {
    return "id";
  }
}

let current: Lang = typeof window === "undefined" ? "id" : read();

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Private mode: the choice lasts until reload.
  }
  document.documentElement.lang = lang;
  for (const l of listeners) l();
}

export function useLang(): Lang {
  const lang = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  return lang;
}

/** Pick the string for the current language: t({ id: "...", en: "..." }). */
export const pick = <T,>(lang: Lang, s: { id: T; en: T }): T => s[lang];

/** Spending categories (slugs from classify.ts) as people read them. */
const CATEGORY: Record<string, { id: string; en: string }> = {
  uncategorized: { id: "Belum dikategorikan", en: "Not categorised yet" },
  food: { id: "Makan & minum", en: "Food & drink" },
  "food/groceries": { id: "Belanja harian", en: "Groceries" },
  "food/dining": { id: "Makan di luar", en: "Eating out" },
  "food/coffee": { id: "Kopi & jajan", en: "Coffee & snacks" },
  "food/delivery": { id: "Pesan antar makanan", en: "Food delivery" },
  transport: { id: "Transportasi", en: "Transport" },
  "transport/ride-hailing": { id: "Ojek & taksi online", en: "Ride-hailing" },
  "transport/fuel": { id: "Bensin", en: "Fuel" },
  "transport/parking-toll": { id: "Parkir & tol", en: "Parking & toll" },
  "transport/public": { id: "Transportasi umum", en: "Public transport" },
  shopping: { id: "Belanja", en: "Shopping" },
  "shopping/online": { id: "Belanja online", en: "Online shopping" },
  "shopping/clothing": { id: "Pakaian", en: "Clothing" },
  "shopping/electronics": { id: "Elektronik", en: "Electronics" },
  bills: { id: "Tagihan", en: "Bills" },
  "bills/electricity": { id: "Listrik (PLN)", en: "Electricity (PLN)" },
  "bills/phone-internet": { id: "Pulsa & internet", en: "Phone & internet" },
  subscriptions: { id: "Langganan", en: "Subscriptions" },
  home: { id: "Rumah", en: "Home" },
  health: { id: "Kesehatan", en: "Health" },
  entertainment: { id: "Hiburan", en: "Entertainment" },
  travel: { id: "Jalan-jalan", en: "Travel" },
  "personal-care": { id: "Perawatan diri", en: "Personal care" },
  fees: { id: "Biaya bank", en: "Bank fees" },
  tax: { id: "Pajak", en: "Tax" },
  other: { id: "Lainnya", en: "Other" },
  "income/refund": { id: "Refund", en: "Refunds" },
};

export function categoryLabel(slug: string, lang: Lang): string {
  return CATEGORY[slug]?.[lang] ?? CATEGORY[slug.split("/")[0]!]?.[lang] ?? slug;
}
