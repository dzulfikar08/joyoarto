import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Search } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import {
  CheckMark,
  CheckSlot,
  findOption,
  focusOnMount,
  GROUP_LABEL_CLASS,
  ITEM_CLASS,
  normalizeItems,
  OptionBody,
  POPUP_CLASS,
  TriggerContent,
  triggerClass,
  useLazy,
  type NormalGroup,
  type SelectBaseProps,
  type SelectOption,
} from "./select";

/** Lower case without accents: "Café" and "cafe" match, so do "Ñandú" and "nandu". */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

const words = (text: string) =>
  foldText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Every word of the query must start a word of the label, hint or keywords: "gro" finds Groceries, "dining" finds
 * the slug food/dining, "1234" finds "··1234", "nandu" finds "Ñandú".
 */
export function matchesOption(option: SelectOption, query: string): boolean {
  const wanted = words(query);
  if (!wanted.length) return true;
  const have = words([option.label, option.hint, option.keywords].filter(Boolean).join(" "));
  return wanted.every((w) => have.some((h) => h.startsWith(w)));
}

/** Groups with only the options that match; empty groups dropped. */
export function filterGroups(groups: readonly NormalGroup[], query: string): NormalGroup[] {
  if (!query.trim()) return groups as NormalGroup[];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((o) => matchesOption(o, query)) }))
    .filter((g) => g.items.length);
}

/**
 * Pick one from a long list: a popover with a search field on top. Search ignores case and accents and also matches
 * hints and keywords (slugs). Typing on the closed trigger opens it with that text; arrows move, Enter
 * picks, Esc closes. On touch screens the search field is not focused on open, so the keyboard stays down until the
 * user taps it.
 */
export function Combobox({
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
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  ...aria
}: SelectBaseProps & { searchPlaceholder?: string; emptyText?: string }) {
  const groups = React.useMemo(() => normalizeItems(items, none), [items, none]);
  const current = findOption(groups, value);
  const { live, openOnMount, placeholderProps } = useLazy(lazy);
  const [open, setOpen] = React.useState(openOnMount);
  const [query, setQuery] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  // Stable, so it runs on mount only (a lazy control takes focus once, not on every render).
  const setTrigger = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (openOnMount) focusOnMount(node);
    },
    [openOnMount],
  );
  const shown = React.useMemo(() => filterGroups(groups, query), [groups, query]);
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
    <ComboboxPrimitive.Root
      items={groups}
      filteredItems={shown}
      value={current ? value : null}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
      itemToStringLabel={(v: string) => findOption(groups, v)?.label ?? ""}
      inputValue={query}
      onInputValueChange={(next) => setQuery(next)}
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => !isOpen && setQuery("")}
      name={name}
      required={required}
      disabled={disabled}
      autoHighlight
    >
      <ComboboxPrimitive.Trigger
        {...triggerProps}
        ref={setTrigger}
        onKeyDown={(event) => {
          // Type-ahead on the closed trigger: open with the typed text as the search.
          if (
            !open &&
            event.key.length === 1 &&
            event.key !== " " &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            event.preventDefault();
            setQuery(event.key);
            setOpen(true);
          }
        }}
      >
        <TriggerContent
          label={current?.label}
          placeholder={placeholder}
          size={size}
          dense={dense}
        />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          className="z-50 outline-none"
          sideOffset={4}
          align="start"
          collisionPadding={8}
        >
          <ComboboxPrimitive.Popup
            className={cn(
              POPUP_CLASS,
              "flex max-h-[min(26rem,var(--available-height))] w-72 flex-col",
            )}
            aria-label={aria["aria-label"]}
            // Phones: keep the keyboard down (it would cover the list) until the user taps the search field.
            initialFocus={(openType) =>
              openType === "touch" || window.matchMedia("(pointer: coarse)").matches
                ? triggerRef.current
                : true
            }
          >
            <div className="relative shrink-0 p-1.5 pb-0">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4.5 mt-[3px] size-4 -translate-y-1/2 text-muted-foreground"
              />
              <ComboboxPrimitive.Input
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-10 w-full rounded-xl border border-transparent bg-muted pr-3 pl-9 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:text-sm"
              />
            </div>
            <ComboboxPrimitive.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">
              {emptyText}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="min-h-0 flex-1 scroll-py-1.5 overflow-y-auto overscroll-contain p-1.5 empty:hidden">
              {(group: NormalGroup) => (
                <ComboboxPrimitive.Group key={group.key} items={group.items} className="block">
                  {group.label && (
                    <ComboboxPrimitive.GroupLabel className={GROUP_LABEL_CLASS}>
                      {group.label}
                    </ComboboxPrimitive.GroupLabel>
                  )}
                  <ComboboxPrimitive.Collection>
                    {(option: SelectOption) => (
                      <ComboboxPrimitive.Item
                        key={option.value}
                        value={option.value}
                        disabled={option.disabled}
                        className={ITEM_CLASS}
                      >
                        <CheckSlot>
                          <ComboboxPrimitive.ItemIndicator>
                            <CheckMark />
                          </ComboboxPrimitive.ItemIndicator>
                        </CheckSlot>
                        <OptionBody option={option} />
                      </ComboboxPrimitive.Item>
                    )}
                  </ComboboxPrimitive.Collection>
                </ComboboxPrimitive.Group>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
