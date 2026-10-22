import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * The guarantee behind /admin: the deck is reachable only with a bearer
 * token minted by the standalone admin credential system, and by nothing
 * else. In particular a customer's signed-in account must not open it, and
 * the refusal must not distinguish "no token" from "wrong token" from
 * "this route does not exist".
 */

const modules: Record<string, () => Promise<unknown>> = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./admin.ts": () => import("./admin"),
  "./adminAuth.ts": () => import("./adminAuth"),
  // The lifetime meeting counter is written by the room-creation path, so the
  // test drives the real mutation rather than stuffing the table directly.
  "./meetings.ts": () => import("./meetings"),
};

function deployment() {
  return convexTest({ schema, modules });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type Deployment = ReturnType<typeof deployment>;

/** A live administrator session, as login would issue it. */
async function withAdmin(t: Deployment, email = "ops@example.test") {
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email,
      name: "Operator",
      // Placeholder: these tests exercise the access boundary, and the token
      // below is verified by hash exactly as a real one is.
      passwordHash: "irrelevant",
      passwordSalt: "irrelevant",
      passwordSetAt: Date.now(),
    }),
  );
  const token = `token-for-${adminId}`;
  const sessionHash = await sha256Hex(token);
  await t.run((ctx) =>
    ctx.db.patch(adminId, {
      sessionHash,
      sessionExpiresAt: Date.now() + 3_600_000,
    }),
  );
  return { adminId, token };
}

const pagination = {
  numItems: 25,
  cursor: null,
  endCursor: undefined,
  id: undefined,
  maximumRowsRead: undefined,
  maximumBytesRead: undefined,
} as const;

describe("admin surface", () => {
  test("no token is refused, indistinguishably from a dead route", async () => {
    const t = deployment();
    for (const bad of [undefined, "", "not-a-real-token"]) {
      await expect(t.query(api.admin.overview, { token: bad })).rejects.toThrow(
        "Not found.",
      );
      await expect(
        t.query(api.admin.users, { token: bad, paginationOpts: pagination }),
      ).rejects.toThrow("Not found.");
      await expect(
        t.query(api.admin.payments, { token: bad, paginationOpts: pagination }),
      ).rejects.toThrow("Not found.");
    }
  });

  test("a customer session cannot open it", async () => {
    const t = deployment();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Ordinary person",
        email: "person@example.test",
        nexaId: "NX-PERSON",
        // Even an explicitly-flagged customer role is not admin access.
        role: "admin",
      }),
    );
    await expect(
      t.withIdentity({ subject: userId }).query(api.admin.overview, {}),
    ).rejects.toThrow("Not found.");
  });

  test("an expired session is refused even though the token is real", async () => {
    const t = deployment();
    const { adminId, token } = await withAdmin(t);
    await t.run((ctx) =>
      ctx.db.patch(adminId, { sessionExpiresAt: Date.now() - 1 }),
    );
    await expect(
      t.query(api.admin.overview, { token }),
    ).rejects.toThrow("Not found.");
  });

  test("a disabled administrator is refused", async () => {
    const t = deployment();
    const { adminId, token } = await withAdmin(t);
    await t.run((ctx) => ctx.db.patch(adminId, { disabled: true }));
    await expect(
      t.query(api.admin.overview, { token }),
    ).rejects.toThrow("Not found.");
  });

  test("a valid token reads everything", async () => {
    const t = deployment();
    const { token } = await withAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Customer",
        email: "customer@example.test",
        nexaId: "NX-CUSTMR",
      }),
    );

    const overview = await t.query(api.admin.overview, { token });
    expect(overview.users.total).toBe(1);
    expect(overview.users.live).toBe(0);

    const people = await t.query(api.admin.users, {
      token,
      paginationOpts: pagination,
    });
    expect(people.page).toHaveLength(1);
    expect(people.page[0].plan).toBe("free");

    const payments = await t.query(api.admin.payments, {
      token,
      paginationOpts: pagination,
    });
    expect(payments.page).toEqual([]);
  });

  test("a settled payment puts the payer on Business for its period", async () => {
    const t = deployment();
    const { token } = await withAdmin(t);
    const buyerId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Buyer",
        email: "buyer@example.test",
        nexaId: "NX-BUYER1",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("payments", {
        userId: buyerId,
        razorpayOrderId: "order_ABCDEFGH12345678",
        amount: 29900,
        currency: "INR",
        planId: "nexa-meet-business-monthly",
        status: "paid",
        createdAt: Date.now(),
        paidAt: Date.now(),
      }),
    );

    const overview = await t.query(api.admin.overview, { token });
    expect(overview.payments.paid).toBe(1);
    expect(overview.payments.revenuePaise).toBe(29900);
    expect(overview.payments.subscribers).toBe(1);

    const detail = await t.query(api.admin.user, { token, userId: buyerId });
    expect(detail?.plan).toBe("business");
    expect(detail?.lifetimePaise).toBe(29900);
    expect(detail?.payments).toHaveLength(1);
  });

  test("an expired payment still counts as revenue but not as a subscriber", async () => {
    const t = deployment();
    const { token } = await withAdmin(t);
    const lapsedId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Lapsed",
        email: "lapsed@example.test",
        nexaId: "NX-LAPSED",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("payments", {
        userId: lapsedId,
        razorpayOrderId: "order_OLD12345678",
        amount: 29900,
        currency: "INR",
        planId: "nexa-meet-business-monthly",
        status: "paid",
        createdAt: Date.now() - 90 * 86_400_000,
        paidAt: Date.now() - 90 * 86_400_000,
      }),
    );

    const overview = await t.query(api.admin.overview, { token });
    expect(overview.payments.revenuePaise).toBe(29900);
    expect(overview.payments.subscribers).toBe(0);
  });

  test("the lifetime meeting count outlives the room it counted", async () => {
    const t = deployment();
    const { token } = await withAdmin(t);
    const hostId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Host",
        email: "host@example.test",
        nexaId: "NX-HOST01",
      }),
    );

    const before = await t.query(api.admin.overview, { token });
    expect(before.meetings.lifetime).toBe(0);
    expect(before.meetings.since).toBeNull();

    await t.withIdentity({ subject: hostId }).mutation(api.meetings.create, {});
    await t.withIdentity({ subject: hostId }).mutation(api.meetings.create, {});

    const counted = await t.query(api.admin.overview, { token });
    expect(counted.meetings.lifetime).toBe(2);
    expect(counted.meetings.total).toBe(2);
    expect(counted.meetings.since).toBeGreaterThan(0);

    // Rooms are temporary by design — the sweeper deletes them when they end —
    // which is the whole reason the total is a counter and not a row count.
    await t.run(async (ctx) => {
      for (const room of await ctx.db.query("meetings").collect()) {
        await ctx.db.delete(room._id);
      }
    });

    const afterwards = await t.query(api.admin.overview, { token });
    expect(afterwards.meetings.total).toBe(0);
    expect(afterwards.meetings.active).toBe(0);
    expect(afterwards.meetings.lifetime).toBe(2);
  });

  test("an initiated-but-unpaid order is neither", async () => {
    const t = deployment();
    const { token } = await withAdmin(t);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Abandoned",
        email: "abandoned@example.test",
        nexaId: "NX-ABANDN1",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("payments", {
        userId,
        razorpayOrderId: "order_PENDING1234",
        amount: 29900,
        currency: "INR",
        planId: "nexa-meet-business-monthly",
        status: "created",
        createdAt: Date.now(),
      }),
    );

    const overview = await t.query(api.admin.overview, { token });
    expect(overview.payments.initiated).toBe(1);
    expect(overview.payments.revenuePaise).toBe(0);
    expect(overview.payments.subscribers).toBe(0);
  });
});
