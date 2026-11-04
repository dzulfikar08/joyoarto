import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

/** One choice. Values are strings, as with a native `<select>`; "" is the usual "none". */
export interface SelectOption {
  value: string;
  label: string;
  /** Quieter text after the label (last digits, a count). Searched too. */
  hint?: string;
  /** Extra text the search matches (a slug, an institution). Not shown. */
  keywords?: string;
  disabled?: boolean;
}

/** A labelled run of options (a parent category and its children). */
export interface SelectGroup {
  label?: string;
  options: readonly SelectOption[];
}

/** Options, groups, or both: consecutive loose options form one unlabelled group. */
export type SelectItems = readonly (SelectOption | SelectGroup)[];

export type SelectSize = "default" | "sm" | "xs";

/** Props shared by Select and Combobox. */
export interface SelectBaseProps {
  value: string;
  onValueChange: (value: string) => void;
  items: SelectItems;
  /** Adds a first choice with value "" (e.g. "Uncategorized", "All accounts"). */
  none?: string;
  /** Shown when the value matches no option. */
  placeholder?: string;
  /** Matches Input (default 48px) and Button (sm 40px, xs 32px). */
  size?: SelectSize;
  /** Tighter side padding for short values in narrow cells. */
  dense?: boolean;
  /** The trigger's id, for `<label htmlFor>`. */
  id?: string;
  /** Submits the value with a surrounding form. */
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /**
   * Render a plain button until first use, then mount the real control already open. For long tables where every row
   * has a picker: closed rows cost one button, not a Base UI root.
   */
  lazy?: boolean;
}

export type NormalGroup = { key: string; label?: string; items: SelectOption[] };

/** Every input shape as a list of groups (the none choice first, in a group of its own). */
export function normalizeItems(items: SelectItems, none?: string): NormalGroup[] {
  const groups: NormalGroup[] = [];
  if (none !== undefined) groups.push({ key: "none", items: [{ value: "", label: none }] });
  let loose: SelectOption[] | null = null;
  items.forEach((item, i) => {
    if ("options" in item) {
      loose = null;
      if (item.options.length)
        groups.push({ key: `g${i}`, label: item.label, items: [...item.options] });
    } else {
      if (!loose) groups.push({ key: `g${i}`, items: (loose = []) });
      loose.push(item);
    }
  });
  return groups;
}

export function findOption(
  groups: readonly NormalGroup[],
  value: string,
): SelectOption | undefined {
  for (const g of groups) for (const o of g.items) if (o.value === value) return o;
  return undefined;
}

/** Same look as the old NativeSelect: muted fill, rounded, ring on focus. */
export function triggerClass(size: SelectSize, dense: boolean) {
  return cn(
    "inline-flex min-w-0 cursor-pointer items-center justify-between gap-1.5 rounded-xl border border-transparent bg-muted text-left text-foreground outline-none select-none transition-[border-color,box-shadow,background-color]",
    "focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 data-popup-open:border-ring/60 data-popup-open:bg-card",
    "disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive/60",
    size === "xs"
      ? "h-8 pr-2.5 pl-3 text-xs"
      : size === "sm"
        ? "h-10 pr-3 pl-3.5 text-sm"
        : "h-12 pr-3 pl-3.5 text-base",
    dense && "pr-1.5 pl-2.5",
  );
}

export function TriggerContent({
  label,
  placeholder,
  size,
  dense,
}: {
  label?: string;
  placeholder?: string;
  size: SelectSize;
  dense: boolean;
}) {
  return (
    <>
      <span
        className={cn("min-w-0 flex-1 truncate", label === undefined && "text-muted-foreground")}
      >
        {label ?? placeholder ?? " "}
      </span>
      <ChevronDown
        aria-hidden
        className={cn(
          "shrink-0 text-muted-foreground",
          dense || size === "xs" ? "size-3.5" : "size-4",
        )}
      />
    </>
  );
}

export const POPUP_CLASS =
  "min-w-(--anchor-width) max-w-[min(var(--available-width),calc(100vw-1rem))] origin-(--transform-origin) rounded-2xl bg-popover text-popover-foreground shadow-float ring-1 ring-foreground/5 outline-none transition-[scale,opacity] dark:ring-foreground/12 duration-100 ease-out data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0";

export const ITEM_CLASS =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-3 pl-2 text-sm text-foreground/90 outline-none select-none sm:min-h-9 data-highlighted:bg-muted data-highlighted:text-foreground data-selected:font-semibold data-selected:text-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50";

export const GROUP_LABEL_CLASS =
  "px-2 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase select-none";

export function OptionBody({ option }: { option: SelectOption }) {
  return (
    <>
      <span className="min-w-0 flex-1 break-words">{option.label}</span>
      {option.hint && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{option.hint}</span>
      )}
    </>
  );
}

export function CheckSlot({ children }: { children: React.ReactNode }) {
  return <span className="grid size-4 shrink-0 place-items-center text-primary">{children}</span>;
}

export function CheckMark() {
  return <Check className="size-3.5" strokeWidth={3} aria-hidden />;
}

/**
 * The cheap stand-in for `lazy`: a button that looks like the trigger. Click, Enter, Space or ArrowDown hand over to
 * the real control, already open.
 */
export function useLazy(lazy: boolean | undefined) {
  const [live, setLive] = React.useState(!lazy);
  const placeholderProps = {
    onClick: () => setLive(true),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setLive(true);
      }
    },
  };
  return { live, openOnMount: !!lazy, placeholderProps };
}

/**
 * Pick one from a short list: a styled listbox in a popover. Type-ahead jumps to an option, arrows move, Enter
 * picks, Esc closes. Use Combobox for long lists that need search.
 */
export function Select({
  value,
  onValueChange,
  items,
  none,
  placeholder,
  size = "default",
  dense = false,
  id,
  name,
  disabled,
  required,
  className,
  title,
  lazy,
  ...aria
}: SelectBaseProps) {
  const groups = React.useMemo(() => normalizeItems(items, none), [items, none]);
  const current = findOption(groups, value);
  const { live, openOnMount, placeholderProps } = useLazy(lazy);
  const triggerProps = {
    id,
    title,
    disabled,
    className: cn(triggerClass(size, dense), className),
    ...aria,
  };

  if (!live) {
    return (
      <>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={false}
          {...triggerProps}
          {...placeholderProps}
        >
          <TriggerContent
            label={current?.label}
            placeholder={placeholder}
            size={size}
            dense={dense}
          />
        </button>
        {name && <input type="hidden" name={name} value={value} />}
      </>
    );
  }
  return (
    <SelectPrimitive.Root
      value={current ? value : null}
      onValueChange={(next) => next !== null && onValueChange(next)}
      name={name}
      required={required}
      disabled={disabled}
      defaultOpen={openOnMount}
      modal={false}
    >
      <SelectPrimitive.Trigger {...triggerProps} ref={openOnMount ? focusOnMount : undefined}>
        <TriggerContent
          label={current?.label}
          placeholder={placeholder}
          size={size}
          dense={dense}
        />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          className="z-50 outline-none"
          sideOffset={4}
          align="start"
          collisionPadding={8}
          alignItemWithTrigger={false}
        >
          <SelectPrimitive.Popup
            className={cn(POPUP_CLASS, "flex max-h-[min(24rem,var(--available-height))] flex-col")}
          >
            <SelectPrimitive.List className="min-h-0 flex-1 scroll-py-1.5 overflow-y-auto overscroll-contain p-1.5">
              {groups.map((group) => (
                <SelectPrimitive.Group key={group.key} className="block">
                  {group.label && (
                    <SelectPrimitive.GroupLabel className={GROUP_LABEL_CLASS}>
                      {group.label}
                    </SelectPrimitive.GroupLabel>
                  )}
                  {group.items.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      label={option.label}
                      className={ITEM_CLASS}
                    >
                      <CheckSlot>
                        <SelectPrimitive.ItemIndicator>
                          <CheckMark />
                        </SelectPrimitive.ItemIndicator>
                      </CheckSlot>
                      <SelectPrimitive.ItemText className="min-w-0 flex-1 break-words">
                        {option.label}
                      </SelectPrimitive.ItemText>
                      {option.hint && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {option.hint}
                        </span>
                      )}
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Group>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** Keeps keyboard focus on the trigger when a lazy control swaps itself in. */
export function focusOnMount(node: HTMLElement | null) {
  node?.focus({ preventScroll: true });
}
