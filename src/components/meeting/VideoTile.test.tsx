import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Participant } from "@/shared/types";
import { VideoTile } from "./VideoTile";

/**
 * Self-view mirroring is a camera convention only. A screen share replaces
 * the camera in the same tile, so it must render unflipped — on the
 * presenter's own stage and on every remote tile.
 */

const MIRROR_CLASS = "-scale-x-100";

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    sessionId: "s1",
    nexaId: "NEXA-1",
    displayName: "Ada",
    joinedAt: 0,
    isHost: false,
    micOn: true,
    camOn: true,
    sharing: false,
    ...overrides,
  };
}

/** Minimal MediaStream stand-in: the tile only reads tracks while rendering. */
function stream({ capture = false } = {}): MediaStream {
  return {
    getVideoTracks: () => [{ id: "video" }],
    getAudioTracks: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    isCapture: capture,
  } as unknown as MediaStream;
}

function render({
  isLocal,
  sharing,
  mirror,
  captured,
  camOn = true,
}: {
  isLocal: boolean;
  sharing: boolean;
  mirror: boolean;
  captured: boolean;
  camOn?: boolean;
}) {
  return renderToStaticMarkup(
    <VideoTile
      participant={participant({ sharing, camOn })}
      isLocal={isLocal}
      stream={stream({ capture: captured })}
      status="connected"
      mirror={mirror}
    />,
  );
}

describe("VideoTile mirroring", () => {
  it("mirrors the local camera self-view when the preference is on", () => {
    const html = render({
      isLocal: true,
      sharing: false,
      mirror: true,
      captured: false,
    });
    expect(html).toContain(MIRROR_CLASS);
  });

  it("leaves the local camera self-view unflipped when the preference is off", () => {
    const html = render({
      isLocal: true,
      sharing: false,
      mirror: false,
      captured: false,
    });
    expect(html).not.toContain(MIRROR_CLASS);
  });

  it("never flips the local presenter's shared screen (camera on)", () => {
    const html = render({
      isLocal: true,
      sharing: true,
      mirror: true,
      captured: true,
    });
    expect(html).not.toContain(MIRROR_CLASS);
  });

  it("never flips the local presenter's shared screen (camera off)", () => {
    const html = render({
      isLocal: true,
      sharing: true,
      mirror: true,
      captured: true,
      camOn: false,
    });
    expect(html).not.toContain(MIRROR_CLASS);
  });

  it("never flips captured content even if the presenter flag lags", () => {
    const html = render({
      isLocal: true,
      sharing: false,
      mirror: true,
      captured: true,
    });
    expect(html).not.toContain(MIRROR_CLASS);
  });

  it("renders a remote participant's shared screen unflipped", () => {
    const html = render({
      isLocal: false,
      sharing: true,
      mirror: false,
      captured: false,
    });
    expect(html).not.toContain(MIRROR_CLASS);
  });
});
