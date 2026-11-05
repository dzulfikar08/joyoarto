// Items for the searchable pickers (components/ui/picker.tsx), the same grouping as the web's apps/web/src/lib/options.ts:
// categories grouped by parent, then loose ones by kind; accounts with their last digits as a hint. Pure.

export type PickerOption = { value: string; label: string; hint?: string; keywords?: string };
export type PickerGroup = { label: string | null; options: PickerOption[] };

type Category = { slug: string; name: string; kind: string };
type Account = { id: string; name: string; last4?: string | null; institution?: string | null; type?: string | null; archived?: boolean };

const KIND_LABEL: Record<string, string> = { expense: "Spending", income: "Income", transfer: "Transfers" };

export function categoryOptions(categories: readonly Category[]): PickerGroup[] {
  const sorted = [...categories].sort((a, b) => a.slug.localeCompare(b.slug));
  const parentOf = (slug: string) => (slug.includes("/") ? slug.slice(0, slug.indexOf("/")) : null);
  const hasChildren = new Set(sorted.map((c) => parentOf(c.slug)).filter((p): p is string => p !== null));
  const option = (c: Category): PickerOption => ({ value: c.slug, label: c.name, keywords: c.slug });

  const parents = new Map<string, PickerGroup>();
  const loose = new Map<string, PickerOption[]>();
  for (const c of sorted) {
    const top = parentOf(c.slug) ?? c.slug;
    if (hasChildren.has(top)) {
      let group = parents.get(top);
      if (!group) {
        const parentRow = sorted.find((x) => x.slug === top);
        group = { label: parentRow?.name ?? top.charAt(0).toUpperCase() + top.slice(1), options: [] };
        parents.set(top, group);
      }
      group.options.push(option(c));
    } else {
      const list = loose.get(c.kind) ?? [];
      list.push(option(c));
      loose.set(c.kind, list);
    }
  }
  const byKind = ["expense", "income", "transfer", ...[...loose.keys()].filter((k) => !(k in KIND_LABEL))]
    .filter((k) => loose.has(k))
    .map((k) => ({ label: KIND_LABEL[k] ?? k, options: loose.get(k)! }));
  return [...parents.values(), ...byKind];
}

/** Accounts for a picker; archived ones are left out unless `includeArchived`. */
export function accountOptions(accounts: readonly Account[], includeArchived = false): PickerGroup[] {
  return [
    {
      label: null,
      options: accounts
        // Receivable accounts (what an employer owes for reimbursable expenses) never pay for anything.
        .filter((a) => (includeArchived || !a.archived) && a.type !== "receivable")
        .map((a) => ({
          value: a.id,
          label: a.name,
          hint: [a.institution, a.last4 ? `··${a.last4}` : null].filter(Boolean).join(" ") || undefined,
          keywords: [a.institution, a.type?.replace("_", " ")].filter(Boolean).join(" "),
        })),
    },
  ];
}

/** Case- and accent-insensitive search over label, hint and keywords; empty groups are dropped. */
export function filterOptions(groups: readonly PickerGroup[], query: string): PickerGroup[] {
  const q = fold(query.trim());
  if (!q) return groups.filter((g) => g.options.length);
  const words = q.split(/\s+/);
  return groups
    .map((g) => ({
      label: g.label,
      options: g.options.filter((o) => {
        const hay = fold(`${o.label} ${o.hint ?? ""} ${o.keywords ?? ""} ${g.label ?? ""}`);
        return words.every((w) => hay.includes(w));
      }),
    }))
    .filter((g) => g.options.length);
}

export function findOption(groups: readonly PickerGroup[], value: string | null | undefined): PickerOption | undefined {
  if (!value) return undefined;
  for (const g of groups) for (const o of g.options) if (o.value === value) return o;
  return undefined;
}

export function optionCount(groups: readonly PickerGroup[]): number {
  return groups.reduce((n, g) => n + g.options.length, 0);
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
