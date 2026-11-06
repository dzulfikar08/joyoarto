import { ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * Collapsed-by-default row for explanations, how-it-works text and secondary detail (tables behind a chart), so a
 * screen shows its numbers first. Same pattern as JoyoRogo's InfoAccordion (web) and Disclosure (native).
 * - default: its own card on the paper canvas;
 * - `plain`: no background, for use inside a card (a top divider separates it from the content above).
 */
function Disclosure({
  title,
  icon,
  plain,
  defaultOpen,
  className,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  plain?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details data-slot="disclosure" open={defaultOpen} className={cn("group/disclosure", plain ? "border-t border-border" : "rounded-2xl bg-card", className)}>
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-2xl text-sm font-semibold select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden",
          plain ? "pt-1 text-muted-foreground hover:text-foreground" : "px-4",
        )}
      >
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
        <span className="min-w-0 flex-1">{title}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open/disclosure:rotate-180" />
      </summary>
      <div className={cn("space-y-2 text-sm leading-relaxed text-muted-foreground", plain ? "pb-1" : "px-4 pb-4")}>{children}</div>
    </details>
  );
}

export { Disclosure };
