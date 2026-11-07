// Money flow for one month: where the money came from (income categories), where it went (spending groups and their
// subcategories) and what was left (saved). `buildFlow` turns category totals into nodes and links; `layoutFlow` places
// them for an SVG band chart. Both are pure and shared by the web and the phone app (no server imports).

/** One category's total for the month, positive: income received or spending (refunds already netted). */
export type FlowTotal = { slug: string | null; amount: number };

export type FlowNodeKind = "source" | "hub" | "group" | "saved" | "item";

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  amount: number;
  /** The category slug to open transactions for; null for computed nodes (hub, saved, "more in…"). */
  slug: string | null;
  /** The group this node belongs to (its own id for a group), for colour and highlighting. */
  group: string | null;
  column: number;
};

export type FlowLink = { source: string; target: string; amount: number; group: string | null };

export type Flow = {
  income: number;
  spending: number;
  /** Income minus spending when positive. */
  saved: number;
  /** Spending above income, paid from balances. */
  fromSavings: number;
  nodes: FlowNode[];
  links: FlowLink[];
};

export const FLOW_GROUPS = 8;
export const FLOW_ITEMS_PER_GROUP = 4;
export const FLOW_SOURCES = 4;

const top = (slug: string | null) => (slug ? slug.split("/")[0]! : null);

/**
 * Nodes in columns: 0 income sources (and "From savings" when spending exceeded income), 1 the hub (all money in),
 * 2 spending groups and "Saved", 3 each group's subcategories (only for groups split into more than one).
 */
export function buildFlow(input: {
  income: FlowTotal[];
  expense: FlowTotal[];
  name: (slug: string) => string | undefined;
  groups?: number;
  itemsPerGroup?: number;
  sources?: number;
}): Flow {
  const maxGroups = input.groups ?? FLOW_GROUPS;
  const maxItems = input.itemsPerGroup ?? FLOW_ITEMS_PER_GROUP;
  const maxSources = input.sources ?? FLOW_SOURCES;
  const label = (slug: string | null, fallback: string) => (slug ? (input.name(slug) ?? slug) : fallback);

  const incomeRows = merge(input.income).filter((r) => r.amount > 0);
  const expenseRows = merge(input.expense).filter((r) => r.amount > 0);
  const income = sum(incomeRows);
  const spending = sum(expenseRows);
  const saved = Math.max(0, income - spending);
  const fromSavings = Math.max(0, spending - income);
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  if (income + spending === 0) return { income, spending, saved, fromSavings, nodes, links };

  // Sources, largest first; the tail becomes one "Other income".
  const sources = capped(
    incomeRows.sort((a, b) => b.amount - a.amount),
    maxSources,
    (rest) => ({ slug: null, amount: sum(rest), label: "Other income" }),
  );
  for (const s of sources) {
    const id = `source:${s.rest ? "rest" : (s.slug ?? "uncategorized")}`;
    nodes.push({ id, kind: "source", label: s.label ?? label(s.slug, "Uncategorized income"), amount: s.amount, slug: s.slug, group: null, column: 0 });
    links.push({ source: id, target: "hub", amount: s.amount, group: null });
  }
  if (fromSavings > 0) {
    nodes.push({ id: "source:savings", kind: "source", label: "From savings", amount: fromSavings, slug: null, group: null, column: 0 });
    links.push({ source: "source:savings", target: "hub", amount: fromSavings, group: null });
  }
  nodes.push({ id: "hub", kind: "hub", label: "Money in", amount: income + fromSavings, slug: null, group: null, column: 1 });

  // Spending groups (top-level categories), largest first; the tail becomes "Everything else".
  const byGroup = new Map<string, FlowTotal[]>();
  for (const r of expenseRows) {
    const key = top(r.slug) ?? "";
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }
  const groups = [...byGroup]
    .map(([key, rows]) => ({ key, rows, amount: sum(rows) }))
    .sort((a, b) => b.amount - a.amount);
  const shown = groups.length > maxGroups ? groups.slice(0, maxGroups - 1) : groups;
  const rest = groups.slice(shown.length);

  for (const g of shown) {
    const id = `group:${g.key || "uncategorized"}`;
    const slug = g.key || null;
    nodes.push({ id, kind: "group", label: label(slug, "Uncategorized"), amount: g.amount, slug, group: id, column: 2 });
    links.push({ source: "hub", target: id, amount: g.amount, group: id });
    if (g.rows.length < 2) continue;
    const items = capped(
      g.rows.sort((a, b) => b.amount - a.amount),
      maxItems,
      (more) => ({ slug: null, amount: sum(more), label: `More ${label(slug, "uncategorized").toLowerCase()}` }),
    );
    for (const it of items) {
      const itemId = it.rest ? `item:${g.key}:more` : `item:${it.slug ?? `${g.key}:uncategorized`}`;
      // Spending on the group itself (no subcategory) is shown under the group's own name.
      nodes.push({ id: itemId, kind: "item", label: it.label ?? label(it.slug, "Uncategorized"), amount: it.amount, slug: it.slug, group: id, column: 3 });
      links.push({ source: id, target: itemId, amount: it.amount, group: id });
    }
  }
  if (rest.length) {
    const amount = rest.reduce((s, g) => s + g.amount, 0);
    nodes.push({ id: "group:rest", kind: "group", label: "Everything else", amount, slug: null, group: "group:rest", column: 2 });
    links.push({ source: "hub", target: "group:rest", amount, group: "group:rest" });
    for (const g of rest) {
      const itemId = `item:${g.key || "uncategorized"}`;
      const slug = g.key || null;
      nodes.push({ id: itemId, kind: "item", label: label(slug, "Uncategorized"), amount: g.amount, slug, group: "group:rest", column: 3 });
      links.push({ source: "group:rest", target: itemId, amount: g.amount, group: "group:rest" });
    }
  }
  if (saved > 0) {
    nodes.push({ id: "saved", kind: "saved", label: "Saved", amount: saved, slug: null, group: "saved", column: 2 });
    links.push({ source: "hub", target: "saved", amount: saved, group: "saved" });
  }
  return { income, spending, saved, fromSavings, nodes, links };
}

function merge(rows: FlowTotal[]): FlowTotal[] {
  const out = new Map<string | null, number>();
  for (const r of rows) out.set(r.slug, (out.get(r.slug) ?? 0) + r.amount);
  return [...out].map(([slug, amount]) => ({ slug, amount }));
}

function sum(rows: { amount: number }[]) {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** The first `max` rows, or `max - 1` and one row standing for the rest. */
function capped<T extends FlowTotal>(rows: T[], max: number, other: (rest: T[]) => FlowTotal & { label: string }): (FlowTotal & { label?: string; rest?: boolean })[] {
  if (rows.length <= max) return rows;
  return [...rows.slice(0, max - 1), { ...other(rows.slice(max - 1)), rest: true }];
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout

export type FlowColumn = {
  /** Left edge of the column's node bars. */
  x: number;
  /** Least vertical room a node takes (so its label fits), before the gap. */
  minSlot: number;
  gap: number;
};

export type PlacedNode = FlowNode & { x: number; y: number; h: number; /** Room reserved for the label, centred on the bar. */ slot: number };
export type PlacedLink = FlowLink & { path: string; width: number };

/**
 * Place the nodes of `columns.length` consecutive columns (the first one is `first`; other columns are dropped) and
 * draw each link as a filled band between its nodes. Values are scaled so the tallest column fits `height`; columns
 * whose labels need more room grow the chart instead (see the returned height).
 */
export function layoutFlow(
  flow: Pick<Flow, "nodes" | "links">,
  opts: { columns: FlowColumn[]; first?: number; height: number; nodeWidth: number },
): { nodes: PlacedNode[]; links: PlacedLink[]; height: number } {
  const first = opts.first ?? 0;
  const cols = opts.columns.map((col, i) => ({ ...col, nodes: flow.nodes.filter((n) => n.column === first + i) }));
  const ids = new Set(cols.flatMap((c) => c.nodes.map((n) => n.id)));
  const links = flow.links.filter((l) => ids.has(l.source) && ids.has(l.target));

  // One scale for every column, from the column with the most value per pixel left after gaps.
  const k = Math.min(
    ...cols
      .filter((c) => c.nodes.length)
      .map((c) => {
        const total = c.nodes.reduce((s, n) => s + n.amount, 0);
        return total > 0 ? Math.max(1, opts.height - c.gap * (c.nodes.length - 1)) / total : Number.POSITIVE_INFINITY;
      }),
  );
  const scale = Number.isFinite(k) ? k : 0;

  const placed = new Map<string, PlacedNode>();
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  let bottom = 0;
  cols.forEach((col, ci) => {
    let y = 0;
    for (const n of col.nodes) {
      const h = Math.max(1.5, n.amount * scale);
      const slot = Math.max(h, col.minSlot);
      // Follow the parent: start no higher than where the band into this node leaves its source.
      const parent = ci > 0 ? links.find((l) => l.target === n.id) : undefined;
      const from = parent ? placed.get(parent.source) : undefined;
      const want = from ? from.y + linkStart(links, from.id, n.id, scale) : y;
      const top = Math.max(y, want - (slot - h) / 2);
      const node: PlacedNode = { ...n, x: col.x, y: top + (slot - h) / 2, h, slot };
      placed.set(n.id, node);
      y = top + slot + col.gap;
      bottom = Math.max(bottom, top + slot);
    }
  });

  const out: PlacedLink[] = [];
  for (const l of links) {
    const s = placed.get(l.source)!;
    const t = placed.get(l.target)!;
    const w = l.amount * scale;
    const sy = s.y + (outOffset.get(s.id) ?? 0);
    const ty = t.y + (inOffset.get(t.id) ?? 0);
    outOffset.set(s.id, (outOffset.get(s.id) ?? 0) + w);
    inOffset.set(t.id, (inOffset.get(t.id) ?? 0) + w);
    out.push({ ...l, width: w, path: band(s.x + opts.nodeWidth, sy, t.x, ty, Math.max(w, 0.75)) });
  }
  return { nodes: [...placed.values()], links: out, height: Math.ceil(bottom) };
}

/** How far down its source's bar the band to `target` starts (bands leave in the order of the links). */
function linkStart(links: FlowLink[], source: string, target: string, scale: number): number {
  let y = 0;
  for (const l of links) {
    if (l.source !== source) continue;
    if (l.target === target) return y;
    y += l.amount * scale;
  }
  return y;
}

/** A band of width `w` from (x0, y0) down to (x1, y1), as a closed SVG path with horizontal tangents. */
export function band(x0: number, y0: number, x1: number, y1: number, w: number): string {
  const mx = (x0 + x1) / 2;
  const r = (v: number) => Math.round(v * 10) / 10;
  return [
    `M${r(x0)},${r(y0)}`,
    `C${r(mx)},${r(y0)} ${r(mx)},${r(y1)} ${r(x1)},${r(y1)}`,
    `L${r(x1)},${r(y1 + w)}`,
    `C${r(mx)},${r(y1 + w)} ${r(mx)},${r(y0 + w)} ${r(x0)},${r(y0 + w)}`,
    "Z",
  ].join(" ");
}

/**
 * Column positions for a chart `width` wide. Without sources the hub sits at the left edge (its label goes above the
 * chart); with them, source labels take the left `sourceLabel` pixels. Group labels sit left of their bar, item labels
 * right of theirs (`itemLabel` pixels).
 */
export function flowColumns(width: number, opts: { sources: boolean; nodeWidth?: number }) {
  const nodeWidth = opts.nodeWidth ?? 6;
  const itemLabel = Math.round(Math.min(220, Math.max(104, width * 0.36)));
  const itemX = width - itemLabel - nodeWidth;
  const left = opts.sources ? Math.round(Math.min(170, width * 0.16)) : 0;
  const span = itemX - left;
  const groupX = Math.round(left + span * (opts.sources ? 0.68 : 0.56));
  const groupLabel = Math.max(72, Math.round(groupX - (opts.sources ? left + span * 0.34 : 0) - 14));
  const columns: FlowColumn[] = [
    ...(opts.sources ? [{ x: left, minSlot: 34, gap: 12 }] : []),
    { x: opts.sources ? Math.round(left + span * 0.34) : 0, minSlot: 0, gap: 0 },
    { x: groupX, minSlot: 34, gap: 10 },
    { x: itemX, minSlot: 30, gap: 6 },
  ];
  return { columns, first: opts.sources ? 0 : 1, nodeWidth, labels: { source: Math.max(0, left - 10), group: groupLabel, item: itemLabel - 8 } };
}

/** Cut `text` to about `px` pixels of label at `charPx` per character, with an ellipsis. */
export function fitLabel(text: string, px: number, charPx = 6.6): string {
  const max = Math.max(3, Math.floor(px / charPx));
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Colour slot per group id, in chart order: the chart series 0, 1, 2… for groups (by size), "saved" for what was
 * saved, null (neutral grey) for "Everything else" and uncategorised spending and past the last series.
 */
export function flowColorSlots(nodes: Pick<FlowNode, "id" | "kind">[], series = 6): Map<string, number | "saved" | null> {
  const out = new Map<string, number | "saved" | null>();
  let i = 0;
  for (const n of nodes) {
    if (n.kind === "saved") out.set(n.id, "saved");
    else if (n.kind === "group") out.set(n.id, n.id === "group:rest" || n.id === "group:uncategorized" || i >= series ? null : i++);
  }
  return out;
}

/** "39%", "6,1%", "0,4%": a share of `total` as Indonesians write it (whole numbers from 10%). */
export function flowPct(amount: number, total: number): string {
  if (!total) return "0%";
  const v = (amount / total) * 100;
  return `${v >= 10 || v === 0 ? Math.round(v) : (Math.round(v * 10) / 10).toString().replace(".", ",")}%`;
}

/** Whether tapping a node can open its transactions (computed nodes like money in, saved and "more…" cannot). */
export function flowOpens(n: Pick<FlowNode, "id" | "kind">): boolean {
  return (n.kind === "group" || n.kind === "item" || n.kind === "source") && !["group:rest", "source:savings", "source:rest"].includes(n.id) && !n.id.endsWith(":more");
}
