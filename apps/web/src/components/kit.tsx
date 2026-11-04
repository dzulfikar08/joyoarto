// App-level building blocks on top of @baroka/ui: the JoyoArto mark and wordmark, page headers, the theme switch.

import { Label } from "@baroka/ui/components/label";
import { cn } from "@baroka/ui/lib/utils";
import { type Theme, useTheme } from "@baroka/ui/hooks/use-theme";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

/** The JoyoArto tile: the Joyo "J" holding a gold coin ("arto" is money in Javanese). Same drawing as /icon.svg. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-7 shrink-0", className)}>
      <rect width="64" height="64" rx="16" fill="#3752ae" />
      <path d="M40.5 13.5v21.5a13.5 13.5 0 0 1-27 0" fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" />
      <circle cx="27" cy="33.5" r="6.25" fill="#eebc4a" />
    </svg>
  );
}

/** "JoyoArto" set in the family style: "Joyo" in ink, "Arto" in the brand blue. */
export function Wordmark({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[1.0625rem] font-extrabold tracking-tight", className)}>
      <BrandMark className={markClassName} />
      <span>
        Joyo<span className="text-primary">Arto</span>
      </span>
    </span>
  );
}

/** Page title block: bold title, optional subtitle and a right-side action. */
export function PageHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-1", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

/**
 * A form field: label on top, the control, then an optional hint. Pass the control's id as `htmlFor`. `labelClassName`
 * restyles the label (dense editors use a smaller, muted one).
 */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  labelClassName,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor} className={labelClassName}>
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const THEMES: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "system", label: "System", icon: <Monitor className="size-4" /> },
  { value: "light", label: "Light", icon: <Sun className="size-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-4" /> },
];

/** Segmented light / dark / system switch. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex rounded-full bg-muted p-1", className)}>
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={theme === t.value}
          onClick={() => setTheme(t.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            theme === t.value && "bg-segment text-foreground shadow-sm",
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}
