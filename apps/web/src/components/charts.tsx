// Small inline-SVG charts for the dashboard and plan. No chart library; sized to their container.
import { cn } from "@baroka/ui/lib/utils";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { compactMoney, niceTicks } from "@/lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e?.contentRect.width ?? 0)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Column with a 4px rounded top and a square base on the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function LineKey({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="14" height="8" aria-hidden className="shrink-0">
      <line x1="1" y1="4" x2="13" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />
    </svg>
  );
}

export function SwatchKey({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

export function Legend({ items }: { items: { key: ReactNode; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.key}
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // Keep the box inside the chart: flip to the left of the pointer past the middle.
  const left = x > width / 2;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-float ring-1 ring-foreground/5"
      style={left ? { right: width - x + 10 } : { left: x + 10 }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({ color, value, label, dashed }: { color?: string; value: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {color && <LineKey color={color} dashed={dashed} />}
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

const PAD = { top: 12, right: 12, bottom: 22, left: 44 };

type CumulativePoint = { day: number; current: number | null; previous: number; currentDisplay: string | null; previousDisplay: string };

/** Running spending this month against last month, by day of month. Crosshair snaps to the nearest day. */
export function CumulativeChart({
  points,
  currentLabel,
  previousLabel,
  monthShort,
  prevShort,
  height = 200,
}: {
  points: CumulativePoint[];
  currentLabel: string;
  previousLabel: string;
  monthShort: string;
  prevShort: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => Math.max(p.current ?? 0, p.previous)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] ?? max;
  const iw = Math.max(0, width - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const x = (day: number) => PAD.left + (n > 1 ? ((day - 1) / (n - 1)) * iw : 0);
  const y = (v: number) => PAD.top + ih - (v / top) * ih;

  const prevPath = points.map((p, i) => `${i ? "L" : "M"}${x(p.day)},${y(p.previous)}`).join("");
  const cur = points.filter((p) => p.current !== null);
  const curPath = cur.map((p, i) => `${i ? "L" : "M"}${x(p.day)},${y(p.current!)}`).join("");
  const last = cur[cur.length - 1];
  const areaPath = last ? `${curPath}L${x(last.day)},${y(0)}L${x(1)},${y(0)}Z` : "";
  const lastPrev = points[n - 1];

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / Math.max(1, rect.width);
    setHover(Math.min(n, Math.max(1, Math.round(rel * (n - 1)) + 1)));
  };
  const h = hover ? points[hover - 1] : null;
  const xTicks = [1, 8, 15, 22, n].filter((d, i, a) => d <= n && a.indexOf(d) === i && !(d !== n && n - d < 4));

  return (
    <div ref={ref} className="relative select-none">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Cumulative spending by day: ${currentLabel} against ${previousLabel}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {compactMoney(t)}
              </text>
            </g>
          ))}
          {xTicks.map((d) => (
            <text key={d} x={x(d)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
              {d}
            </text>
          ))}
          <path d={prevPath} fill="none" stroke="var(--viz-previous)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 4" />
          {areaPath && <path d={areaPath} fill="var(--viz-series-1-wash)" />}
          {curPath && <path d={curPath} fill="none" stroke="var(--viz-series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          {h && <line x1={x(h.day)} x2={x(h.day)} y1={PAD.top} y2={y(0)} stroke="var(--viz-axis)" strokeWidth="1" />}
          {h && <circle cx={x(h.day)} cy={y(h.previous)} r="4" fill="var(--viz-previous)" stroke="var(--viz-surface)" strokeWidth="2" />}
          {h?.current != null && <circle cx={x(h.day)} cy={y(h.current)} r="4" fill="var(--viz-series-1)" stroke="var(--viz-surface)" strokeWidth="2" />}
          {!h && last && <circle cx={x(last.day)} cy={y(last.current!)} r="4" fill="var(--viz-series-1)" stroke="var(--viz-surface)" strokeWidth="2" />}
          {/* Direct end labels: the month names, in text ink; the line beside carries the colour. */}
          {!h && lastPrev && (
            <text
              x={width - PAD.right}
              // Below its line when this month's line ends above it, so the two end labels never stack.
              y={last && last.day === n && last.current! >= lastPrev.previous ? y(lastPrev.previous) + 14 : y(lastPrev.previous) - 6}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {prevShort}
            </text>
          )}
          {!h && last && (
            <text
              x={x(last.day) + (last.day > n - 4 ? -6 : 6)}
              // Sit on the side away from last month's line at the same day.
              y={last.current! >= last.previous ? y(last.current!) - 8 : y(last.current!) + 14}
              textAnchor={last.day > n - 4 ? "end" : "start"}
              className="fill-foreground text-[10px] font-medium"
            >
              {monthShort}
            </text>
          )}
          <rect
            x={PAD.left}
            y={0}
            width={iw}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {h && (
        <Tooltip x={x(h.day)} width={width}>
          <div className="mb-0.5 text-muted-foreground">Day {h.day}</div>
          {h.currentDisplay && <TooltipRow color="var(--viz-series-1)" value={h.currentDisplay} label={monthShort} />}
          <TooltipRow color="var(--viz-previous)" dashed value={h.previousDisplay} label={prevShort} />
        </Tooltip>
      )}
    </div>
  );
}

type CashflowMonth = { month: string; label: string; income: number; expense: number; incomeDisplay: string; expenseDisplay: string; netDisplay: string; savingsRate: number | null };

/** Income and spending columns per month; the selected month's label is bold. Tap a month to open it. */
export function CashflowChart({
  months,
  selected,
  onSelect,
  height = 200,
}: {
  months: CashflowMonth[];
  selected: string;
  onSelect?: (month: string) => void;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] ?? max;
  const iw = Math.max(0, width - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const band = months.length ? iw / months.length : 0;
  const bar = Math.max(4, Math.min(24, (band - 12) / 2 - 1));
  const y = (v: number) => PAD.top + ih - (Math.max(0, v) / top) * ih;
  const h = hover !== null ? months[hover] : null;

  return (
    <div ref={ref} className="relative select-none">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Income and spending, last six months">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {compactMoney(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = PAD.left + band * i + band / 2;
            const active = hover === i;
            return (
              <g key={m.month} opacity={hover !== null && !active ? 0.55 : 1}>
                <path d={columnPath(cx - bar - 1, y(m.income), bar, y(0) - y(m.income))} fill="var(--viz-series-1)" />
                <path d={columnPath(cx + 1, y(m.expense), bar, y(0) - y(m.expense))} fill="var(--viz-series-2)" />
                <text
                  x={cx}
                  y={height - 6}
                  textAnchor="middle"
                  className={`text-[10px] ${m.month === selected ? "fill-foreground font-semibold" : "fill-muted-foreground"}`}
                >
                  {m.label}
                </text>
                <rect
                  x={PAD.left + band * i}
                  y={0}
                  width={band}
                  height={height}
                  fill="transparent"
                  className={onSelect ? "cursor-pointer" : ""}
                  tabIndex={0}
                  aria-label={`${m.label}: income ${m.incomeDisplay}, spending ${m.expenseDisplay}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect?.(m.month)}
                  onKeyDown={(e) => e.key === "Enter" && onSelect?.(m.month)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {h && hover !== null && (
        <Tooltip x={PAD.left + band * hover + band / 2} width={width}>
          <div className="mb-0.5 text-muted-foreground">{h.label}</div>
          <TooltipRow color="var(--viz-series-1)" value={h.incomeDisplay} label="income" />
          <TooltipRow color="var(--viz-series-2)" value={h.expenseDisplay} label="spending" />
          <TooltipRow value={h.netDisplay} label={`net${h.savingsRate !== null ? ` · ${h.savingsRate}% saved` : ""}`} />
        </Tooltip>
      )}
    </div>
  );
}

type ProjectionSeries = { key: string; label: string; color: string; dashed?: boolean; values: number[] };

/** Balance over time for several scenarios on one axis (which may go below zero). Crosshair snaps to the nearest month. */
export function ProjectionChart({
  months,
  series,
  format,
  monthShort,
  height = 220,
}: {
  months: string[];
  series: ProjectionSeries[];
  format: (minor: number) => string;
  monthShort: (m: string) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = months.length;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const up = niceTicks(max);
  const down = min < 0 ? niceTicks(-min).map((t) => -t) : [0];
  const top = up[up.length - 1] ?? max;
  const bottom = down[down.length - 1] ?? 0;
  const ticks = [...new Set([...down, ...up])].sort((a, b) => a - b);
  const pad = { ...PAD, right: series.length <= 4 ? 64 : 12 };
  const iw = Math.max(0, width - pad.left - pad.right);
  const ih = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * iw : 0);
  const y = (v: number) => pad.top + ih - ((v - bottom) / (top - bottom || 1)) * ih;
  const step = n > 24 ? 12 : n > 12 ? 6 : 3;
  const xTicks = months.map((m, i) => ({ m, i })).filter(({ i }) => i % step === 0);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / Math.max(1, rect.width);
    setHover(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  };
  // End labels: in series order, nudged apart so they never overlap.
  const ends = series.map((s) => ({ s, y: y(s.values[n - 1] ?? 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 12) ends[i]!.y = ends[i - 1]!.y + 12;

  return (
    <div ref={ref} className="relative select-none">
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Liquid balance by month for ${series.map((s) => s.label).join(", ")}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth="1" />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {compactMoney(t)}
              </text>
            </g>
          ))}
          {xTicks.map(({ m, i }) => (
            <text key={m} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : "middle"} className="fill-muted-foreground text-[10px]">
              {monthShort(m)}
            </text>
          ))}
          {series.map((s) => (
            <path
              key={s.key}
              d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("")}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "4 4" : undefined}
            />
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + ih} stroke="var(--viz-axis)" strokeWidth="1" />}
          {hover !== null &&
            series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" fill={s.color} stroke="var(--viz-surface)" strokeWidth="2" />)}
          {series.length <= 4 &&
            ends.map(({ s, y: ly }) => (
              <text key={s.key} x={width - pad.right + 6} y={ly} dy="0.32em" className="fill-foreground text-[10px]">
                {s.label.length > 10 ? `${s.label.slice(0, 9)}…` : s.label}
              </text>
            ))}
          <rect
            x={pad.left}
            y={0}
            width={iw}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && months[hover] && (
        <Tooltip x={x(hover)} width={width}>
          <div className="mb-0.5 text-muted-foreground">{months[hover]}</div>
          {[...series]
            .sort((a, b) => (b.values[hover] ?? 0) - (a.values[hover] ?? 0))
            .map((s) => (
              <TooltipRow key={s.key} color={s.color} dashed={s.dashed} value={format(s.values[hover] ?? 0)} label={s.label} />
            ))}
        </Tooltip>
      )}
    </div>
  );
}

export type DonutSlice = { key: string; label: string; value: number; display: string; share: number; color: string };

/** Point on a circle, angle in turns from 12 o'clock, clockwise. */
function polar(c: number, r: number, turn: number) {
  const a = turn * 2 * Math.PI;
  return [c + r * Math.sin(a), c - r * Math.cos(a)] as const;
}

/** Ring segment between two turns (0..1). A full ring is drawn as two halves. */
function ringPath(c: number, r0: number, r1: number, from: number, to: number): string {
  if (to - from >= 0.9999) return ringPath(c, r0, r1, 0, 0.5) + ringPath(c, r0, r1, 0.5, 1);
  const large = to - from > 0.5 ? 1 : 0;
  const [ax, ay] = polar(c, r1, from);
  const [bx, by] = polar(c, r1, to);
  const [cx, cy] = polar(c, r0, to);
  const [dx, dy] = polar(c, r0, from);
  return `M${ax},${ay}A${r1},${r1} 0 ${large} 1 ${bx},${by}L${cx},${cy}A${r0},${r0} 0 ${large} 0 ${dx},${dy}Z`;
}

/**
 * Part-to-whole ring: slices in the order given (largest first), from 12 o'clock clockwise, with surface-coloured gaps.
 * Hover state is owned by the caller so its legend can highlight the same slice.
 */
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  label,
  active,
  onActive,
  onSelect,
  size = 184,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
  /** Text alternative for the whole figure. */
  label: string;
  active: string | null;
  onActive: (key: string | null) => void;
  onSelect?: (key: string) => void;
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const c = size / 2;
  const r1 = c - 2;
  const r0 = r1 * 0.64;
  let at = 0;
  const arcs = slices
    .filter((s) => s.value > 0 && total > 0)
    .map((s) => {
      const from = at;
      at += s.value / total;
      return { s, from, to: at };
    });
  const hit = arcs.find((a) => a.s.key === active);
  const tip = hit ? polar(c, r1 + 6, (hit.from + hit.to) / 2) : null;

  return (
    <div className="relative mx-auto shrink-0 select-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        {total === 0 && <circle cx={c} cy={c} r={(r0 + r1) / 2} fill="none" stroke="var(--viz-grid)" strokeWidth={r1 - r0} />}
        {arcs.map(({ s, from, to }) => (
          <path
            key={s.key}
            d={ringPath(c, r0, r1, from, to)}
            fill={s.color}
            // The surface-coloured stroke is the 2px gap between slices; a single slice needs none.
            stroke={arcs.length > 1 ? "var(--viz-surface)" : "none"}
            strokeWidth="2"
            strokeLinejoin="round"
            opacity={active && active !== s.key ? 0.45 : 1}
            className={cn("transition-opacity", onSelect && "cursor-pointer")}
            onPointerEnter={() => onActive(s.key)}
            onPointerLeave={() => onActive(null)}
            onClick={() => onSelect?.(s.key)}
          />
        ))}
      </svg>
      <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
        <span className="max-w-[7.5rem] font-extrabold leading-tight tracking-tight tabular-nums" style={{ fontSize: centerValue.length > 13 ? 14 : 16 }}>
          {centerValue}
        </span>
      </div>
      {hit && tip && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 w-38 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-float ring-1 ring-foreground/5"
          // Just above the ring for a slice in the top half, just below it otherwise, so it never covers the total in
          // the hole; lined up with the slice but kept within the ring's width so it stays on screen on a phone.
          style={{
            left: Math.min(Math.max(tip[0] - 76, -12), size - 140),
            top: tip[1] < c ? -4 : size + 4,
            transform: tip[1] < c ? "translateY(-100%)" : undefined,
          }}
        >
          <div className="mb-0.5 flex items-center gap-1.5 text-muted-foreground">
            <SwatchKey color={hit.s.color} />
            <span className="truncate">{hit.s.label}</span>
          </div>
          <div>
            <span className="font-semibold tabular-nums text-foreground">{hit.s.display}</span> <span className="text-muted-foreground">· {hit.s.share}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
