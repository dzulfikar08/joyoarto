import type { SelectGroup, SelectOption } from "@baroka/ui/components/select";

type Category = { slug: string; name: string; kind: string };
type Account = {
  id: string;
  name: string;
  last4?: string | null;
  institution?: string | null;
  type?: string | null;
};

const KIND_LABEL: Record<string, string> = {
  expense: "Spending",
  income: "Income",
  transfer: "Transfers",
};

/**
 * Categories for a picker, grouped by parent: each parent with subcategories is a group (the parent itself first),
 * and top-level categories without children are grouped by kind after them. Search matches the slug too.
 */
export function categoryOptions(categories: readonly Category[]): SelectGroup[] {
  const sorted = [...categories].sort((a, b) => a.slug.localeCompare(b.slug));
  const parentOf = (slug: string) => (slug.includes("/") ? slug.slice(0, slug.indexOf("/")) : null);
  const hasChildren = new Set(
    sorted.map((c) => parentOf(c.slug)).filter((p): p is string => p !== null),
  );
  const option = (c: Category): SelectOption => ({
    value: c.slug,
    label: c.name,
    keywords: c.slug,
  });

  const parents = new Map<string, SelectGroup & { options: SelectOption[] }>();
  const loose = new Map<string, SelectOption[]>();
  for (const c of sorted) {
    const top = parentOf(c.slug) ?? c.slug;
    if (hasChildren.has(top)) {
      let group = parents.get(top);
      if (!group) {
        const parentRow = sorted.find((x) => x.slug === top);
        group = {
          label: parentRow?.name ?? top.charAt(0).toUpperCase() + top.slice(1),
          options: [],
        };
        parents.set(top, group);
      }
      group.options.push(option(c));
    } else {
      const list = loose.get(c.kind) ?? [];
      list.push(option(c));
      loose.set(c.kind, list);
    }
  }
  const byKind = [
    "expense",
    "income",
    "transfer",
    ...[...loose.keys()].filter((k) => !(k in KIND_LABEL)),
  ]
    .filter((k) => loose.has(k))
    .map((k) => ({ label: KIND_LABEL[k] ?? k, options: loose.get(k)! }));
  return [...parents.values(), ...byKind];
}

/**
 * Accounts for a picker: the last digits as a hint; search also matches institution and type. Receivable accounts
 * (what an employer owes for reimbursable expenses) never pay for anything, so they are left out.
 */
export function accountOptions(accounts: readonly Account[]): SelectOption[] {
  return accounts.filter((a) => a.type !== "receivable").map((a) => ({
    value: a.id,
    label: a.name,
    hint: a.last4 ? `··${a.last4}` : undefined,
    keywords: [a.institution, a.type?.replace("_", " ")].filter(Boolean).join(" "),
  }));
}
