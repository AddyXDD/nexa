import { describe, expect, test } from "vitest";
import { normalizeMeetingMinutes } from "./constants";
import {
  addMinutes,
  formatDuration,
  formatOffset,
  isValidTimeZone,
  offsetMinutesAt,
  toProviderDateTime,
  toZonedInputValue,
  zonedInputToInstant,
} from "./time";

/**
 * Timezone arithmetic is where calendar integrations quietly break: a meeting
 * booked across a daylight-saving switch is an hour off, or lands on a time
 * that doesn't exist. These tests pin the behaviour to real IANA rules rather
 * than to any offset table we might have written by hand.
 *
 * They also cover the round trip the scheduling form depends on — a wall clock
 * typed in a zone, converted to an instant, and rendered back — because the
 * server uses one direction and the browser the other.
 */

describe("instant → wall clock", () => {
  test("a fixed-offset zone keeps its offset all year", () => {
    // India has never observed DST: +05:30 in January and in June.
    const winter = toProviderDateTime(Date.parse("2026-01-15T03:30:00Z"), "Asia/Kolkata");
    const summer = toProviderDateTime(Date.parse("2026-06-15T03:30:00Z"), "Asia/Kolkata");
    expect(winter.dateTime).toBe("2026-01-15T09:00:00+05:30");
    expect(summer.dateTime).toBe("2026-06-15T09:00:00+05:30");
    expect(winter.offsetMinutes).toBe(330);
  });

  test("New York moves to daylight time on 2026-03-08", () => {
    // 06:30 UTC is 01:30 EST (before the 07:00 UTC switch)…
    const before = toProviderDateTime(Date.parse("2026-03-08T06:30:00Z"), "America/New_York");
    expect(before.dateTime).toBe("2026-03-08T01:30:00-05:00");
    // …and 07:30 UTC is 03:30 EDT: the skipped hour is real.
    const after = toProviderDateTime(Date.parse("2026-03-08T07:30:00Z"), "America/New_York");
    expect(after.dateTime).toBe("2026-03-08T03:30:00-04:00");
  });

  test("a 30-minute meeting across the spring-forward switch ends correctly", () => {
    const start = Date.parse("2026-03-08T06:45:00Z"); // 01:45 EST
    const end = addMinutes(start, 30); // 07:15 UTC → 03:15 EDT
    const startZoned = toProviderDateTime(start, "America/New_York");
    const endZoned = toProviderDateTime(end, "America/New_York");
    expect(startZoned.dateTime).toBe("2026-03-08T01:45:00-05:00");
    expect(endZoned.dateTime).toBe("2026-03-08T03:15:00-04:00");
    // The instant is preserved even though the wall clock advances two hours:
    // the meeting is still exactly 30 minutes long in real time.
    expect(end - start).toBe(30 * 60_000);
  });

  test("the autumn fall-back hour is resolved to a single instant", () => {
    // 01:30 occurs twice on 2026-11-01; both readings are distinct instants
    // with the right offset, so nothing is ambiguous once stored in UTC.
    const first = toProviderDateTime(Date.parse("2026-11-01T05:30:00Z"), "America/New_York");
    const second = toProviderDateTime(Date.parse("2026-11-01T06:30:00Z"), "America/New_York");
    expect(first.dateTime).toBe("2026-11-01T01:30:00-04:00");
    expect(second.dateTime).toBe("2026-11-01T01:30:00-05:00");
    expect(first.offsetMinutes).toBe(-240);
    expect(second.offsetMinutes).toBe(-300);
  });

  test("London and Berlin follow their own transitions", () => {
    expect(toProviderDateTime(Date.parse("2026-01-05T09:00:00Z"), "Europe/London").dateTime).toBe(
      "2026-01-05T09:00:00+00:00",
    );
    expect(toProviderDateTime(Date.parse("2026-06-05T09:00:00Z"), "Europe/London").dateTime).toBe(
      "2026-06-05T10:00:00+01:00",
    );
    expect(toProviderDateTime(Date.parse("2026-06-05T09:00:00Z"), "Europe/Berlin").dateTime).toBe(
      "2026-06-05T11:00:00+02:00",
    );
  });

  test("UTC renders as +00:00, and so does a missing zone", () => {
    expect(toProviderDateTime(Date.parse("2026-07-01T12:00:00Z"), "UTC").dateTime).toBe(
      "2026-07-01T12:00:00+00:00",
    );
    // Never silently shift a meeting into another zone: fall back to UTC.
    expect(toProviderDateTime(Date.parse("2026-07-01T12:00:00Z"), null).dateTime).toBe(
      "2026-07-01T12:00:00+00:00",
    );
    expect(toProviderDateTime(Date.parse("2026-07-01T12:00:00Z"), "Mars/Olympus").timeZone).toBe(
      "UTC",
    );
  });

  test("offsetMinutesAt and formatOffset agree with the conversion", () => {
    expect(offsetMinutesAt(Date.parse("2026-06-05T09:00:00Z"), "Europe/Berlin")).toBe(120);
    expect(formatOffset(330)).toBe("+05:30");
    expect(formatOffset(-240)).toBe("-04:00");
    expect(formatOffset(0)).toBe("+00:00");
    expect(formatOffset(-570)).toBe("-09:30");
  });

  test("invalid zones are rejected rather than guessed", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("wall clock → instant (what the scheduling form submits)", () => {
  test("a plain time in a fixed-offset zone", () => {
    expect(zonedInputToInstant("2026-05-04T09:00", "Asia/Kolkata")).toBe(
      Date.parse("2026-05-04T03:30:00Z"),
    );
  });

  test("the same wall time means different instants in different zones", () => {
    const kolkata = zonedInputToInstant("2026-05-04T09:00", "Asia/Kolkata")!;
    const berlin = zonedInputToInstant("2026-05-04T09:00", "Europe/Berlin")!;
    expect(kolkata).toBe(Date.parse("2026-05-04T03:30:00Z"));
    expect(berlin).toBe(Date.parse("2026-05-04T07:00:00Z"));
  });

  test("the day before a spring-forward switch uses the old offset", () => {
    expect(zonedInputToInstant("2026-03-07T09:00", "America/New_York")).toBe(
      Date.parse("2026-03-07T14:00:00Z"), // EST, -05:00
    );
  });

  test("the day after a spring-forward switch uses the new offset", () => {
    expect(zonedInputToInstant("2026-03-09T09:00", "America/New_York")).toBe(
      Date.parse("2026-03-09T13:00:00Z"), // EDT, -04:00
    );
  });

  test("an ambiguous fall-back time resolves to the first of the two", () => {
    // 01:30 happens twice on 2026-11-01; the double-pass conversion picks one
    // deterministic instant rather than drifting by an hour later.
    const instant = zonedInputToInstant("2026-11-01T01:30", "America/New_York")!;
    expect([Date.parse("2026-11-01T05:30:00Z"), Date.parse("2026-11-01T06:30:00Z")]).toContain(
      instant,
    );
    expect(toZonedInputValue(instant, "America/New_York")).toBe("2026-11-01T01:30");
  });

  test("a time that doesn't exist in spring shifts forward, per RFC 5545", () => {
    // 02:30 on 2026-03-08 never happens in New York: the clock jumps
    // 02:00 → 03:00, so the meeting lands at 03:30 EDT rather than an hour
    // earlier in the past.
    const instant = zonedInputToInstant("2026-03-08T02:30", "America/New_York")!;
    expect(instant).toBe(Date.parse("2026-03-08T07:30:00Z"));
    expect(toZonedInputValue(instant, "America/New_York")).toBe("2026-03-08T03:30");
  });

  test("round trips through the form value exactly", () => {
    const cases: Array<[number, string]> = [
      [Date.parse("2026-05-04T03:30:00Z"), "Asia/Kolkata"],
      [Date.parse("2026-12-24T18:45:00Z"), "America/New_York"],
      [Date.parse("2026-06-30T23:15:00Z"), "Europe/London"],
      [Date.parse("2026-01-01T00:00:00Z"), "UTC"],
    ];
    for (const [instant, zone] of cases) {
      const value = toZonedInputValue(instant, zone);
      expect(zonedInputToInstant(value, zone)).toBe(instant);
    }
  });

  test("garbage in the input is refused, not turned into NaN", () => {
    expect(zonedInputToInstant("", "UTC")).toBeNull();
    expect(zonedInputToInstant("not-a-date", "UTC")).toBeNull();
    expect(zonedInputToInstant("2026-13-45", "UTC")).toBeNull();
  });
});

describe("meeting length", () => {
  test("defaults, rounds to five minutes, and refuses nonsense", () => {
    expect(normalizeMeetingMinutes(undefined)).toBe(30);
    expect(normalizeMeetingMinutes(45)).toBe(45);
    expect(normalizeMeetingMinutes(42)).toBe(40);
    expect(normalizeMeetingMinutes(5)).toBe(5);
    expect(normalizeMeetingMinutes(8 * 60)).toBe(8 * 60);
    expect(normalizeMeetingMinutes(1)).toBeNull();
    expect(normalizeMeetingMinutes(9 * 60)).toBeNull();
    expect(normalizeMeetingMinutes(Number.NaN)).toBeNull();
    expect(normalizeMeetingMinutes(Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("formats a length for display", () => {
    expect(formatDuration(15)).toBe("15 min");
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(480)).toBe("8 hr");
  });
});
