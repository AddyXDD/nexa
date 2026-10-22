import { useId } from "react";

/**
 * Nexa's mark: a heavy N whose right stroke fades from white into a
 * periwinkle gradient, set on a dark rounded tile with a hairline edge.
 *
 * Drawn inline rather than loaded as a file so it stays crisp at any size
 * and never costs a request. Gradient ids are scoped per instance — several
 * marks can share a screen (meeting notices, the 404 page, the legal header)
 * and must not fight over the same id.
 */
export function NexaMark({ className = "size-6" }: { className?: string }) {
  // useId() returns ":r0:"-style values; colons are legal in an id but make
  // url(#…) fragment lookups fragile across engines, so strip them.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tile = `nexa-tile-${uid}`;
  const edge = `nexa-edge-${uid}`;
  const accent = `nexa-accent-${uid}`;

  return (
    <svg viewBox="0 0 512 512" fill="none" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id={tile} cx="47%" cy="40%" r="80%">
          <stop offset="0" stopColor="#2f3135" />
          <stop offset="0.5" stopColor="#1c1e21" />
          <stop offset="1" stopColor="#0c0d0f" />
        </radialGradient>
        <linearGradient
          id={edge}
          x1="0"
          y1="0"
          x2="512"
          y2="512"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.46" />
          <stop offset="1" stopColor="#8fa3ff" stopOpacity="0.72" />
        </linearGradient>
        <linearGradient
          id={accent}
          x1="324"
          y1="132"
          x2="368"
          y2="330"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.42" stopColor="#c6d1f6" />
          <stop offset="0.75" stopColor="#8b9cf0" />
          <stop offset="1" stopColor="#6d80e8" />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="116" fill={`url(#${tile})`} />
      <g fill="#ffffff">
        <path d="M144 132h44v252h-28a16 16 0 0 1-16-16V132Z" />
        <path d="M188 132h44l136 252h-44L188 132Z" />
      </g>
      <path
        d="M324 132h26a18 18 0 0 1 18 18v190l-44-82V132Z"
        fill={`url(#${accent})`}
      />
      <rect
        x="3.5"
        y="3.5"
        width="505"
        height="505"
        rx="112.5"
        stroke={`url(#${edge})`}
        strokeWidth="3.5"
      />
    </svg>
  );
}

/** Mark + wordmark, the standard way Nexa signs its name. */
export function NexaLogo({
  className = "",
  markClassName = "size-6",
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <NexaMark className={markClassName} />
      <span className="text-[15px] font-semibold tracking-[-0.02em]">
        Nexa Meet
      </span>
    </span>
  );
}
