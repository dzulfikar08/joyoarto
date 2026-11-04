import { useState } from "react";

import { cn } from "@baroka/ui/lib/utils";

/** A member's Google profile picture, or their initials when there is none or it fails to load. */
export function Avatar({ name, image, className }: { name?: string | null; image?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xs font-bold text-primary",
        className,
      )}
      aria-hidden
    >
      {image && !broken ? (
        // Google serves these from lh3.googleusercontent.com; no-referrer avoids its occasional 403 on cross-site referrers.
        <img src={image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initials
      )}
    </span>
  );
}
