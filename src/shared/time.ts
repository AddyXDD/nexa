/**
 * Timezone handling, shared by the server and the browser.
 *
 * Every timestamp in Nexa is stored as a UTC epoch millisecond with the host's
 * IANA zone kept beside it. Two conversions are needed, and they must agree
 * exactly or a meeting is booked at one time and shown at another:
 *
 *   instant → wall clock   (`toProviderDateTime`, `formatInZone`) — used to put
 *                          a time on a calendar event and to render it;
 *   wall clock → instant   (`zonedInputToInstant`) — used when somebody types
 *                          a time into the scheduling form.
 *
 * Both go through the zone's real rules at the instant in question (derived
 * from `Intl`, not from a table we maintain), which is what makes the
 * daylight-saving boundaries come out right.
 */

export type ZonedDateTime = {
  /** RFC 3339 local datetime with the zone's real offset, e.g. 09:00:00+05:30. */
  dateTime: string;
  /** The IANA zone, sent alongside so the provider agrees with us. */
  timeZone: string;
  /** Offset from UTC, in minutes, at this instant. */
  offsetMinutes: number;
};

/** Zones offered in the picker when `Intl.supportedValuesOf` is unavailable. */
export const FALLBACK_TIME_ZONES: string[] = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
];

export function isValidTimeZone(zone: string | undefined | null): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime knows, or a curated shortlist. */
export function listTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  try {
    const zones = supported?.("timeZone");
    if (Array.isArray(zones) && zones.length > 0) return zones;
  } catch {
    /* older runtime: fall through to the shortlist */
  }
  return FALLBACK_TIME_ZONES;
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const found = parts.find((entry) => entry.type === type)?.value ?? "0";
  const value = Number(found);
  return Number.isFinite(value) ? value : 0;
}

function wallParts(
  instantMs: number,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  return {
    year: part(parts, "year"),
    month: part(parts, "month"),
    day: part(parts, "day"),
    // Some ICU builds render midnight as hour 24 under h23; normalize it.
    hour: part(parts, "hour") % 24,
    minute: part(parts, "minute"),
    second: part(parts, "second"),
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/**
 * The zone's UTC offset at a given instant, in minutes. Derived by formatting
 * the instant as wall-clock parts in the zone and measuring them against the
 * same parts read as UTC — no offset table to keep up to date.
 */
export function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const wall = wallParts(instantMs, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return Math.round((asUtc - instantMs) / 60_000);
}

/**
 * An instant expressed as the zone's local datetime plus its offset. Falls back
 * to UTC for a missing or unknown zone, so a bad zone string can never move a
 * meeting to an arbitrary time.
 */
export function toProviderDateTime(
  instantMs: number,
  timeZone: string | null | undefined,
): ZonedDateTime {
  const zone = isValidTimeZone(timeZone) ? (timeZone as string) : "UTC";
  const wall = wallParts(instantMs, zone);
  const offsetMinutes = offsetMinutesAt(instantMs, zone);
  return {
    dateTime:
      `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}` +
      `T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
      formatOffset(offsetMinutes),
    timeZone: zone,
    offsetMinutes,
  };
}

/** The wall-clock reading in a zone, for display and for email copy. */
export function formatInZone(
  instantMs: number,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "full", timeStyle: "short" },
): string {
  const zone = isValidTimeZone(timeZone) ? (timeZone as string) : "UTC";
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).format(
    new Date(instantMs),
  );
}

/** `YYYY-MM-DDTHH:mm`, the value a `datetime-local` input expects. */
export function toZonedInputValue(
  instantMs: number,
  timeZone: string | null | undefined,
): string {
  const zone = isValidTimeZone(timeZone) ? (timeZone as string) : "UTC";
  const wall = wallParts(instantMs, zone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(
    wall.hour,
  )}:${pad(wall.minute)}`;
}

/**
 * The reverse: a wall-clock value typed in a zone → the instant it means.
 *
 * The offset depends on the instant we're trying to find, so this reads the
 * zone's offset on both sides of a possible transition and keeps whichever
 * candidate actually renders back as the time that was typed. That resolves
 * all three cases the calendar needs to get right:
 *
 *   - ordinary time: only one candidate matches;
 *   - the ambiguous hour in autumn: both match, and the earlier instant is
 *     chosen deterministically;
 *   - the hour that doesn't exist in spring (02:30 where the clock jumps
 *     02:00 → 03:00): neither matches, and the pre-transition offset is used,
 *     which shifts the meeting forward to 03:30 — the behaviour RFC 5545
 *     prescribes and Google Calendar follows.
 */
export function zonedInputToInstant(
  value: string,
  timeZone: string | null | undefined,
): number | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const zone = isValidTimeZone(timeZone) ? (timeZone as string) : "UTC";
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
  );
  if (!Number.isFinite(asUtc)) return null;

  const halfDay = 12 * 60 * 60_000;
  const candidates = [
    asUtc - offsetMinutesAt(asUtc - halfDay, zone) * 60_000,
    asUtc - offsetMinutesAt(asUtc + halfDay, zone) * 60_000,
  ];
  const requested = toZonedInputValue(asUtc, "UTC");
  const matching = candidates.filter(
    (candidate) => toZonedInputValue(candidate, zone) === requested,
  );
  if (matching.length > 0) return Math.min(...matching);
  // The wall time doesn't exist: the pre-transition offset shifts it forward.
  return candidates[0];
}

export function addMinutes(instantMs: number, minutes: number): number {
  return instantMs + minutes * 60_000;
}

/** "1 hr 30 min" style length, for a duration chip. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
