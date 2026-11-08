import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../lib/utils";
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

/** Centred modal for picking from a list. Esc, the backdrop or the close button dismisses it. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
  className,
  closeLabel = "Close",
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Optional element that opens the dialog. */
  trigger?: ReactElement;
  className?: string;
  closeLabel?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger && <DialogPrimitive.Trigger render={trigger} />}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-black/35 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60" />
        <DialogPrimitive.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-[28px] bg-card px-5 pt-5 pb-5 text-card-foreground shadow-float outline-none",
            "transition-[transform,opacity] duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-opacity",
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-xl font-bold tracking-tight">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="-mx-5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
