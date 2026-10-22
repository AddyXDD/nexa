/**
 * The landing page's backdrop: flat warm paper with a fine print-grain
 * texture. Deliberately plain: no gradients, no orbs, no pattern grids.
 * Fixed, pointer-less, purely decorative.
 */
export function GradientBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute inset-0 bg-background" />
      <div className="nexa-grain absolute inset-0" />
    </div>
  );
}
