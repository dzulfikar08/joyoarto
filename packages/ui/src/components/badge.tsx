import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

const badgeVariants = cva("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5", {
  variants: {
    tone: {
      muted: "bg-muted text-muted-foreground",
      primary: "bg-primary-soft text-primary-ink",
      positive: "bg-positive-soft text-positive-ink",
      warning: "bg-warning-soft text-warning-ink",
      destructive: "bg-destructive-soft text-destructive-ink",
    },
  },
  defaultVariants: { tone: "muted" },
});

function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
