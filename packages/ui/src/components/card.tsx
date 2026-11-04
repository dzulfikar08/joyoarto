import type * as React from "react";

import { cn } from "../lib/utils";

/** White, borderless surface on the paper canvas (JoyoRogo v2 family style). */
function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="card" className={cn("rounded-3xl bg-card p-4 text-card-foreground sm:p-5", className)} {...props} />;
}

/** Title row: title and description on the left, an optional CardAction on the right. */
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("mb-3 grid auto-rows-min items-start gap-0.5 has-data-[slot=card-action]:grid-cols-[1fr_auto]", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("text-base font-bold tracking-tight", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={className} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("mt-4 flex items-center gap-2 border-t pt-4", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
