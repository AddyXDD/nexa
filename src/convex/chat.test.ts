import { describe, expect, test } from "vitest";
import { convexTest, type TestConvexForDataModel } from "convex-test";
import { api } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import schema from "./schema";

/**
 * The privacy guarantee behind one-to-one chat: a direct message must be
 * readable by the two people in the conversation and by nobody else — not
 * by the room, and not by a third participant.
 *
 * These run against a real Convex backend (convex-test), so the index
 * isolation is exercised rather than assumed.
 */

/**
 * convex-test needs the function modules as lazy importers, and derives the
 * module path prefix from the `_generated` entry.
 */
const modules: Record<string, () => Promise<unknown>> = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./chat.ts": () => import("./chat"),
  "./meetings.ts": () => import("./meetings"),
};

/** What `withIdentity` hands back: the accessor without `registerComponent`. */
type Harness = TestConvexForDataModel<DataModel>;

const HOST = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

/** A fresh deployment with one room, opened by a signed-in account. */
async function room() {
  const t = convexTest({ schema, modules });
  const hostUserId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Room owner",
      email: "owner@example.test",
      nexaId: "NX-OWNER1",
    }),
  );
  const { code } = await t
    .withIdentity({ subject: hostUserId })
    .mutation(api.meetings.create, {});
  return { t, code };
}

/** Another account that takes a seat in the room. */
async function seated(
  t: Harness,
  code: string,
  name: string,
  sessionId: string,
): Promise<Harness> {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name,
      email: `${sessionId}@example.test`,
      nexaId: `NX-${sessionId.slice(0, 6).toUpperCase()}`,
    }),
  );
  const as = t.withIdentity({ subject: userId });
  await as.mutation(api.meetings.join, {
    code,
    sessionId,
    micOn: false,
    camOn: false,
    sharing: false,
  });
  return as;
}

describe("meeting chat", () => {
  test("a direct message is invisible to the room and to third parties", async () => {
    const { t, code } = await room();
    const host = await seated(t, code, "Ada", HOST);
    const guest = await seated(t, code, "Ben", GUEST);
    const other = await seated(t, code, "Cleo", OTHER);

    const send = (
      as: Harness,
      sessionId: string,
      text: string,
      toSessionId?: string,
    ) =>
      as.mutation(api.chat.send, {
        code,
        sessionId,
        text,
        ...(toSessionId === undefined ? {} : { toSessionId }),
      });

    await send(host, HOST, "hello room");
    await send(host, HOST, "just between us", GUEST);
    await send(guest, GUEST, "understood", HOST);

    // Everyone sees the room message. Nobody sees the private thread.
    for (const [as, sessionId] of [
      [host, HOST],
      [guest, GUEST],
      [other, OTHER],
    ] as const) {
      const rows = (await as.query(api.chat.list, { code, sessionId })) ?? [];
      expect(rows.map((m) => m.text)).toEqual(["hello room"]);
      expect(rows.every((m) => m.scope === "everyone")).toBe(true);
    }

    // Both sides read the same conversation, in order.
    const hostDm =
      (await host.query(api.chat.listDirect, {
        code,
        sessionId: HOST,
        peerSessionId: GUEST,
      })) ?? [];
    const guestDm =
      (await guest.query(api.chat.listDirect, {
        code,
        sessionId: GUEST,
        peerSessionId: HOST,
      })) ?? [];
    expect(hostDm.map((m) => m.text)).toEqual([
      "just between us",
      "understood",
    ]);
    expect(guestDm.map((m) => m.text)).toEqual(hostDm.map((m) => m.text));

    // A third party reads nothing, whichever pair they ask for.
    for (const [from, to] of [
      [OTHER, HOST],
      [HOST, OTHER],
      [OTHER, GUEST],
    ] as const) {
      expect(
        await other.query(api.chat.listDirect, {
          code,
          sessionId: from,
          peerSessionId: to,
        }),
      ).toEqual([]);
    }

    // The thread is listed for the people in it, and nobody else.
    const peers =
      (await host.query(api.chat.directPeers, { code, sessionId: HOST })) ??
      [];
    expect(peers.map((p) => p.sessionId)).toEqual([GUEST]);
    expect(peers[0]?.displayName).toBe("Ben");
    expect(peers[0]?.inRoom).toBe(true);
    expect(
      await other.query(api.chat.directPeers, { code, sessionId: OTHER }),
    ).toEqual([]);
  });

  test("a direct message needs a real seat in the room", async () => {
    const { t, code } = await room();
    const host = await seated(t, code, "Ada", HOST);

    // Nobody holds this seat, so there's no one to deliver to.
    await expect(
      host.mutation(api.chat.send, {
        code,
        sessionId: HOST,
        text: "psst",
        toSessionId: OTHER,
      }),
    ).rejects.toThrow(/isn't in this meeting/);

    await expect(
      host.mutation(api.chat.send, {
        code,
        sessionId: HOST,
        text: "talking to myself",
        toSessionId: HOST,
      }),
    ).rejects.toThrow(/yourself/);

    // An empty message is a no-op, exactly as in the room channel.
    await expect(
      host.mutation(api.chat.send, { code, sessionId: HOST, text: "   " }),
    ).resolves.toEqual({ ok: false });
  });

  test("a non-participant cannot read the room transcript", async () => {
    const { t, code } = await room();
    const host = await seated(t, code, "Ada", HOST);
    await host.mutation(api.chat.send, {
      code,
      sessionId: HOST,
      text: "secret",
    });

    // A signed-in account with no seat gets nothing, code or no code.
    const strangerId = await t.run((ctx) =>
      ctx.db.insert("users", { nexaId: "NX-STRAY1" }),
    );
    expect(
      await t
        .withIdentity({ subject: strangerId })
        .query(api.chat.list, { code, sessionId: HOST }),
    ).toEqual([]);
  });

  test("direct traffic is counted separately from room traffic", async () => {
    const { t, code } = await room();
    const host = await seated(t, code, "Ada", HOST);
    // Seated so the direct message below has a live addressee.
    await seated(t, code, "Ben", GUEST);

    // Exhaust the room bucket (CHAT_SEND_LIMIT is 30 per 10s)…
    for (let i = 0; i < 30; i++) {
      await host.mutation(api.chat.send, {
        code,
        sessionId: HOST,
        text: `room ${i}`,
      });
    }
    await expect(
      host.mutation(api.chat.send, {
        code,
        sessionId: HOST,
        text: "one too many",
      }),
    ).rejects.toThrow(/too quickly/);

    // …direct messages have their own bucket and are unaffected.
    await expect(
      host.mutation(api.chat.send, {
        code,
        sessionId: HOST,
        text: "still private",
        toSessionId: GUEST,
      }),
    ).resolves.toEqual({ ok: true, scope: "dm" });
  });
});