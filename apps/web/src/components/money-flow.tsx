// The money flow band chart: all money in on the left, spending groups and "Saved" in the middle, each group's
// subcategories on the right; a band's thickness is the money that went that way. Layout: @baroka/api/lib/flow.

import type { AppRouterClient } from "@baroka/api/routers/index";
import { fitLabel, flowColorSlots, flowColumns, flowOpens, flowPct, layoutFlow } from "@baroka/api/lib/flow";
import type { PlacedNode } from "@baroka/api/lib/flow";
import { cn } from "@baroka/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { compactMoney } from "@/lib/format";

export type MoneyFlow = Awaited<ReturnType<AppRouterClient["reports"]["flow"]>>;
export type FlowUnit = "amount" | "pct";

const SERIES = [1, 2, 3, 4, 5, 6].map((i) => `var(--viz-series-${i})`);
const NEUTRAL = "var(--viz-previous)";
const TOP = 40;

/** Colour per group id: the six chart series in order of size, then grey; saved is green. */
export function flowColors(flow: Pick<MoneyFlow, "nodes">): Map<string, string> {
  return new Map([...flowColorSlots(flow.nodes)].map(([id, slot]) => [id, slot === "saved" ? "var(--positive)" : slot === null ? NEUTRAL : SERIES[slot]!]));
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function MoneyFlowChart({
  flow,
  unit = "amount",
  height = 420,
  sources,
  interactive = true,
  className,
}: {
  flow: MoneyFlow;
  unit?: FlowUnit;
  height?: number;
  /** Show income sources as their own column (wide screens). Default: when the chart is at least 720px wide. */
  sources?: boolean;
  interactive?: boolean;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const navigate = useNavigate();
  const [active, setActive] = useState<string | null>(null);
  const sourceCount = flow.nodes.filter((n) => n.kind === "source").length;
  const withSources = (sources ?? width >= 720) && sourceCount > 1;
  const colors = useMemo(() => flowColors(flow), [flow]);
  const total = flow.nodes.find((n) => n.kind === "hub")?.amount ?? 0;

  const geo = useMemo(() => {
    if (!width) return null;
    const g = flowColumns(width, { sources: withSources });
    return { ...g, ...layoutFlow(flow, { columns: g.columns, first: g.first, height, nodeWidth: g.nodeWidth }) };
  }, [flow, width, withSources, height]);

  const value = (n: { amount: number }) => (unit === "pct" ? pct(n.amount, total) : compactMoney(n.amount, flow.currency));
  const colorOf = (n: { kind: string; group: string | null }) => (n.group ? (colors.get(n.group) ?? NEUTRAL) : "var(--viz-muted)");
  const dim = (group: string | null) => active !== null && group !== active;

  const opens = (n: PlacedNode) => interactive && flowOpens(n);
  const open = (n: PlacedNode) => {
    if (!opens(n)) return;
    const range = { from: flow.from, to: flow.to };
    void navigate({ to: "/transactions", search: n.slug ? { category: n.slug, ...range } : { uncategorized: true, ...range } });
  };

  const summary = `Money flow: ${flow.income.display} in, ${flow.spending.display} spent${flow.saved.amount > 0 ? `, ${flow.saved.display} saved` : ""}${flow.fromSavings.amount > 0 ? `, ${flow.fromSavings.display} from savings` : ""}. ${flow.nodes
    .filter((n) => n.kind === "group" || n.kind === "saved")
    .map((n) => `${n.label} ${pct(n.amount, total)}`)
    .join(", ")}.`;

  return (
    <div ref={ref} className={cn("w-full", className)}>
      {geo && (
        <svg width={width} height={geo.height + TOP + 4} role="img" aria-label={summary} className="block overflow-visible">
          <g transform={`translate(0 ${TOP})`}>
            {geo.links.map((l) => (
              <path
                key={`${l.source}>${l.target}`}
                d={l.path}
                fill={l.group ? (colors.get(l.group) ?? NEUTRAL) : "var(--viz-previous)"}
                className="transition-opacity duration-200"
                opacity={l.group ? (dim(l.group) ? 0.08 : active ? 0.5 : 0.26) : 0.16}
              />
            ))}
            {geo.nodes.map((n) => {
              const label = labelFor(n, geo);
              const canOpen = opens(n);
              return (
                <g
                  key={n.id}
                  className={cn("transition-opacity duration-200", canOpen && "cursor-pointer")}
                  opacity={dim(n.group) && n.kind !== "hub" && n.kind !== "source" ? 0.35 : 1}
                  onPointerEnter={() => n.group && setActive(n.group)}
                  onPointerLeave={() => setActive(null)}
                  onClick={() => open(n)}
                  {...(canOpen
                    ? {
                        role: "link",
                        tabIndex: 0,
                        "aria-label": `${n.label}, ${compactMoney(n.amount, flow.currency)}: show transactions`,
                        onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(n)),
                        onFocus: () => n.group && setActive(n.group),
                        onBlur: () => setActive(null),
                      }
                    : {})}
                >
                  <rect x={n.x} y={n.y} width={geo.nodeWidth} height={n.h} rx={Math.min(3, geo.nodeWidth / 2)} fill={n.kind === "hub" || n.kind === "source" ? "var(--viz-muted)" : colorOf(n)} />
                  {label && (
                    <text x={label.x} y={n.y + n.h / 2} textAnchor={label.anchor} className="fill-foreground">
                      {label.twoLines ? (
                        <>
                          <tspan x={label.x} dy="-0.2em" className="text-[12px] font-semibold">
                            {label.text}
                          </tspan>
                          <tspan x={label.x} dy="1.25em" className="fill-muted-foreground text-[11px] tabular-nums">
                            {value(n)}
                          </tspan>
                        </>
                      ) : (
                        <tspan dy="0.35em" className="text-[12px] font-semibold">
                          {label.text} <tspan className="fill-muted-foreground font-normal tabular-nums">{value(n)}</tspan>
                        </tspan>
                      )}
                    </text>
                  )}
                </g>
              );
            })}
            {(() => {
              const hub = geo.nodes.find((n) => n.kind === "hub");
              if (!hub) return null;
              const anchor = withSources ? "middle" : "start";
              const x = withSources ? hub.x + geo.nodeWidth / 2 : 0;
              return (
                <text x={x} y={-22} textAnchor={anchor} className="fill-foreground">
                  <tspan x={x} className="text-[12px] font-semibold">
                    {flow.fromSavings.amount > 0 ? "Income + savings" : "Money in"}
                  </tspan>
                  <tspan x={x} dy="1.3em" className="fill-muted-foreground text-[11px] tabular-nums">
                    {unit === "pct" ? "100%" : compactMoney(hub.amount, flow.currency)}
                  </tspan>
                </text>
              );
            })()}
          </g>
        </svg>
      )}
      {!geo && <div style={{ height: height + TOP }} />}
    </div>
  );
}

function labelFor(n: PlacedNode, geo: { nodeWidth: number; labels: { source: number; group: number; item: number } }) {
  switch (n.kind) {
    case "hub":
      return null;
    case "source":
      return { x: n.x - 8, anchor: "end" as const, text: fitLabel(n.label, geo.labels.source), twoLines: true };
    case "group":
    case "saved":
      return { x: n.x - 8, anchor: "end" as const, text: fitLabel(n.label, geo.labels.group), twoLines: true };
    case "item":
      return { x: n.x + geo.nodeWidth + 8, anchor: "start" as const, text: fitLabel(n.label, geo.labels.item), twoLines: true };
  }
}

export const pct = flowPct;
