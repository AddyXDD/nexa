import { useEffect, useState } from "react";

/**
 * The room's clock, set as marginalia in the masthead.
 *
 * Not a floating card parked over the video: two readings in mono type —
 * how long you've been here, then the wall clock and the day — separated by
 * a hairline. A call should not make anyone lose track of the day, and the
 * stage should not have furniture in the middle of it.
 */

/** Formatters are built once — this component re-renders every second. */
const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const ZONE = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" });

function zoneLabel(date: Date): string {
  const part = ZONE.formatToParts(date).find(
    (entry) => entry.type === "timeZoneName",
  );
  return part?.value ?? "";
}

/** `m:ss` for a short call, `h:mm:ss` once it runs past the hour. */
function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

export function RoomClock({ joinedAt }: { joinedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  // Fallback for the tick before the roster reports our seat's join time.
  const [mountedAt] = useState(() => Date.now());

  // Tick on the second boundary rather than drifting from mount time, so
  // the displayed minute changes exactly when the underlying clock does.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => window.clearTimeout(timer);
  }, []);

  const date = new Date(now);
  const inRoom = elapsedLabel(now - (joinedAt ?? mountedAt));

  return (
    <div
      role="group"
      aria-label="Local time in this room"
      title={`${TIME.format(date)} · ${zoneLabel(date)} — you joined ${inRoom} ago`}
      className="flex shrink-0 items-center gap-2 sm:gap-2.5"
    >
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-[11.5px] tabular-nums text-[color:var(--nexa-bone)]/85">
          {inRoom}
        </span>
        <span className="nexa-label hidden text-white/65 md:inline">
          in room
        </span>
      </span>

      <span aria-hidden className="h-3 w-px bg-white/12" />

      <time
        dateTime={date.toISOString()}
        className="font-mono text-[11.5px] tabular-nums text-white/55"
      >
        {TIME.format(date)}
      </time>

      <span className="nexa-label hidden text-white/65 xl:inline">
        {DATE.format(date)} · {zoneLabel(date)}
      </span>
    </div>
  );
}
