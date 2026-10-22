import type { ReactNode } from "react";

/**
 * Tooltip for icon controls: appears on hover and keyboard focus after a
 * short delay, always paired with the button's `aria-label` so screen
 * readers get the same words. Compact, ink-toned, and never animated more
 * than a fade — tooltips are wayfinding, not decoration.
 */
export function Tooltip({
  label,
  hint,
  disabled = false,
  side = "top",
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      {!disabled && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background opacity-0 shadow-[0_12px_28px_-12px_rgba(0,0,0,0.6)] transition-opacity delay-150 duration-100 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${
            side === "top" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {label}
          {hint && (
            <kbd className="rounded border border-background/25 px-1 py-0.5 font-mono text-[9px] font-normal leading-none text-background/65">
              {hint}
            </kbd>
          )}
        </span>
      )}
    </span>
  );
}
