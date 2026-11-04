import type * as React from "react";

import { cn } from "../lib/utils";

/** Filled like Input; 16px text so iOS never zooms. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-base text-foreground transition-[border-color,box-shadow,background-color] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive/60 aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
