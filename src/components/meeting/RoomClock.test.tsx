import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomClock } from "./RoomClock";

/**
 * The room's timer lives in this corner card now, next to the clock — never
 * in the middle of the stage. These assertions cover the three things the
 * card promises: the local wall clock, the local date/zone context, and the
 * time spent in the room.
 */

describe("RoomClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the local clock face and the time spent in the room", () => {
    vi.useFakeTimers();
    const now = new Date(2026, 9, 20, 14, 32, 5);
    vi.setSystemTime(now);

    const html = renderToStaticMarkup(
      <RoomClock joinedAt={now.getTime() - (12 * 60_000 + 4_000)} />,
    );

    // The clock face follows the viewer's locale, so derive the expected
    // string the same way the component does rather than assuming 24h.
    const clockFace = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);
    expect(html).toContain(clockFace);
    expect(html).toContain("2026-10-20T");
    expect(html).toContain("in room");
    expect(html).toContain("12:04");
  });

  it("counts from the seat's join time, not from page load", () => {
    vi.useFakeTimers();
    const now = new Date(2026, 9, 20, 9, 0, 0);
    vi.setSystemTime(now);

    const html = renderToStaticMarkup(
      <RoomClock joinedAt={now.getTime() - 3_600_000 - 5_000} />,
    );

    // Past the hour the duration grows an hours field instead of counting
    // minutes past 60.
    expect(html).toContain("1:00:05");
  });

  it("falls back to its own mount time before the roster reports a seat", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));

    const html = renderToStaticMarkup(<RoomClock />);

    expect(html).toContain("in room");
    expect(html).toContain("0:00");
  });
});
