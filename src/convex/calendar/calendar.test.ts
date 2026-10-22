import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest, type TestConvexForDataModel } from "convex-test";
import { CALENDAR, SCHEDULING } from "../../shared/constants";
import { api, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import schema from "../schema";
import { GOOGLE_SCOPES } from "./providers/google";
import { encryptSecret, sha256Base64Url, sha256Hex } from "./secrets";

/**
 * The calendar integration, against a real Convex backend with a fake Google.
 *
 * `fetch` is the only seam: the adapter makes HTTP calls through it and nothing
 * else in the system leaves the process, so stubbing it gives an end-to-end test
 * of the flow — OAuth state, token sealing, event creation/patching/deletion,
 * retries and authorization — without a network or a Google account.
 *
 * The fake is stateful on purpose. It keeps real events keyed by id and returns
 * Google's actual conflict behaviour (409 on a duplicate id), because the
 * property under test is that a retried create converges on one event rather
 * than making a second one.
 */

/* ------------------------------------------------------------------ *
 * Test harness
 * ------------------------------------------------------------------ */

const modules: Record<string, () => Promise<unknown>> = {
  "./_generated/server.ts": () => import("../_generated/server"),
  "./http.ts": () => import("../http"),
  "./calendar/connections.ts": () => import("./connections"),
  "./calendar/sync.ts": () => import("./sync"),
  "./schedule.ts": () => import("../schedule"),
};

type Harness = TestConvexForDataModel<DataModel>;

const HOST = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";

type RecordedRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
};

type ScriptedFailure = {
  match: string;
  mode: "network" | "status" | "afterNetwork";
  status?: number;
  body?: unknown;
  remaining: number;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const NOT_FOUND_BODY = {
  error: { message: "Not Found", errors: [{ reason: "notFound" }] },
};

function parseBody(init?: RequestInit): Record<string, unknown> {
  const raw = init?.body;
  if (typeof raw !== "string" || raw.length === 0) return {};
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const contentType = String(headers["Content-Type"] ?? "");
  if (contentType.includes("json")) {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** A stand-in for Google: OAuth endpoints plus a stateful event store. */
class FakeGoogle {
  events = new Map<string, Record<string, unknown>>();
  requests: RecordedRequest[] = [];
  private script: ScriptedFailure[] = [];
  refreshInvalid = false;
  private accessTokenSeq = 0;
  accountEmail = "person@nexameet.in";
  /** Set true to simulate a Workspace account whose id_token has no email. */
  omitEmailFromIdToken = false;

  /** Stop failing: the next request hits the happy path again. */
  stopFailing(): void {
    this.script = [];
  }

  failNext(
    match: string,
    failure: Omit<ScriptedFailure, "match" | "remaining"> & { times?: number },
  ): void {
    this.script.push({
      match,
      mode: failure.mode,
      status: failure.status,
      body: failure.body,
      remaining: failure.times ?? 1,
    });
  }

  private takeFailure(method: string, pathname: string) {
    const key = `${method} ${pathname}`;
    const found = this.script.find(
      (entry) => entry.remaining > 0 && key.includes(entry.match),
    );
    if (!found) return undefined;
    found.remaining -= 1;
    return found;
  }

  private idToken(): string {
    const payload: Record<string, string> = { sub: "google-sub-1" };
    if (!this.omitEmailFromIdToken) payload.email = this.accountEmail;
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
  }

  private tokenEndpoint(body: Record<string, unknown>): Response {
    const grant = String(body.grant_type ?? "");
    if (grant === "refresh_token") {
      if (this.refreshInvalid) {
        return json(400, {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        });
      }
      this.accessTokenSeq += 1;
      // Google usually omits the refresh token on a refresh response.
      return json(200, {
        access_token: `access-${this.accessTokenSeq}`,
        expires_in: 3600,
        scope: GOOGLE_SCOPES.join(" "),
      });
    }
    this.accessTokenSeq += 1;
    return json(200, {
      access_token: `access-${this.accessTokenSeq}`,
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: GOOGLE_SCOPES.join(" "),
      id_token: this.idToken(),
    });
  }

  private eventsEndpoint(
    method: string,
    eventId: string | null,
    body: Record<string, unknown>,
  ): Response {
    if (method === "POST") {
      const id =
        typeof body.id === "string" ? body.id : `generated-${this.events.size + 1}`;
      if (this.events.has(id)) {
        return json(409, {
          error: {
            message: "The requested identifier already exists.",
            errors: [{ reason: "duplicate" }],
          },
        });
      }
      const event = {
        ...body,
        id,
        htmlLink: `https://calendar.google.com/event?eid=${id}`,
        organizer: { email: this.accountEmail },
      };
      this.events.set(id, event);
      return json(200, event);
    }
    if (eventId === null) return json(404, NOT_FOUND_BODY);
    const existing = this.events.get(eventId);
    if (method === "GET") return existing ? json(200, existing) : json(404, NOT_FOUND_BODY);
    if (method === "PATCH") {
      if (!existing) return json(404, NOT_FOUND_BODY);
      // Patch semantics: supplied fields win, supplied arrays replace.
      const merged = { ...existing, ...body, id: eventId };
      this.events.set(eventId, merged);
      return json(200, merged);
    }
    if (method === "DELETE") {
      if (!existing) return json(410, NOT_FOUND_BODY);
      this.events.delete(eventId);
      return new Response(null, { status: 204 });
    }
    return json(405, { error: { message: "Method not allowed." } });
  }

  private handle(
    method: string,
    url: URL,
    body: Record<string, unknown>,
  ): Response {
    if (url.pathname === "/token") return this.tokenEndpoint(body);
    if (url.pathname === "/revoke") return new Response("{}", { status: 200 });
    if (url.pathname === "/v1/userinfo") {
      return json(200, { email: this.accountEmail, sub: "google-sub-1" });
    }
    const match = url.pathname.match(
      /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/,
    );
    if (match) {
      return this.eventsEndpoint(
        method,
        match[2] ? decodeURIComponent(match[2]) : null,
        body,
      );
    }
    throw new Error(`Unhandled request in test: ${method} ${url.pathname}`);
  }

  fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const url = new URL(href);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = parseBody(init);
    this.requests.push({ method, path: url.pathname, query: url.searchParams, body });

    const failure = this.takeFailure(method, url.pathname);
    if (failure?.mode === "network") throw new TypeError("fetch failed");
    if (failure?.mode === "status") {
      // A 5xx means the request did not take effect.
      return json(
        failure.status ?? 500,
        failure.body ?? {
          error: {
            message: "Backend Error",
            errors: [{ reason: "backendError" }],
          },
        },
      );
    }

    // Handle first: `afterNetwork` is the dangerous case — the provider *did*
    // process the request and only the response was lost.
    const response = this.handle(method, url, body);
    if (failure?.mode === "afterNetwork") throw new TypeError("socket hang up");
    return response;
  };

  requestsTo(match: string): RecordedRequest[] {
    return this.requests.filter(
      (entry) => `${entry.method} ${entry.path}`.includes(match),
    );
  }
}

let google: FakeGoogle;

beforeEach(() => {
  google = new FakeGoogle();
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.CALENDAR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.CONVEX_SITE_URL = "https://nexa-test.convex.site";
  delete process.env.CALENDAR_REDIRECT_URI;
  delete process.env.NEXA_SITE_URL;
  vi.stubGlobal("fetch", google.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function fresh(): Harness {
  return convexTest({ schema, modules });
}

/** A signed-in account (Nexa requires an email to schedule anything). */
async function account(t: Harness, identity = HOST, label = "Host") {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: label,
      email: `${label.toLowerCase()}-${identity.slice(0, 4)}@example.test`,
      nexaId: `NX-${identity.slice(0, 6).toUpperCase()}`,
    }),
  );
  return { userId, as: t.withIdentity({ subject: userId }) };
}

/** A connection as the callback would leave it: sealed tokens, no plaintext. */
async function connect(t: Harness, userId: string, accessToken = "access-token-1") {
  return await t.run(async (ctx) =>
    ctx.db.insert("calendarConnections", {
      userId: userId as never,
      provider: "google",
      status: "connected",
      accountEmail: "person@nexameet.in",
      accountId: "google-sub-1",
      scopes: [...GOOGLE_SCOPES],
      accessTokenEnc: await encryptSecret(accessToken),
      refreshTokenEnc: await encryptSecret("refresh-1"),
      accessTokenExpiresAt: Date.now() + 3_600_000,
      keyVersion: 1,
      calendarId: "primary",
      connectedAt: Date.now(),
    }),
  );
}

async function book(
  t: Harness,
  as: Harness,
  overrides: {
    startsAt?: number;
    durationMinutes?: number;
    timeZone?: string;
    invitees?: string[];
    title?: string;
  } = {},
) {
  const startsAt = overrides.startsAt ?? Date.now() + 3_600_000;
  const result = await as.mutation(api.schedule.schedule, {
    title: overrides.title ?? "Design review",
    startsAt,
    timeZone: overrides.timeZone ?? "Asia/Kolkata",
    invitees: overrides.invitees ?? ["priya@example.test"],
    durationMinutes: overrides.durationMinutes ?? 45,
  });
  return { code: result.code, startsAt };
}

async function linkRow(t: Harness) {
  return await t.run(async (ctx) => await ctx.db.query("calendarEvents").first());
}

async function connectionRow(t: Harness) {
  return await t.run(async (ctx) => await ctx.db.query("calendarConnections").first());
}

/* ------------------------------------------------------------------ *
 * Connecting
 * ------------------------------------------------------------------ */

describe("connecting a calendar", () => {
  test("refuses to start a connect flow for a signed-out visitor", async () => {
    const t = fresh();
    await expect(
      t.action(api.calendar.connections.startConnect, {}),
    ).rejects.toThrow(/Not authenticated/i);
  });

  // The regression this guards: a guest session could complete the whole
  // consent flow, leaving a "Connected" calendar beside a scheduling form
  // that refuses guests. Nothing a guest booked could ever reach it.
  test("refuses to start a connect flow for a guest session", async () => {
    const t = fresh();
    const guestId = await t.run((ctx) =>
      ctx.db.insert("users", { isAnonymous: true, nexaId: "NX-GUEST2" }),
    );

    await expect(
      t
        .withIdentity({ subject: guestId })
        .action(api.calendar.connections.startConnect, {}),
    ).rejects.toThrow(CALENDAR.guestNeedsSignIn);

    // Refused before anything was written, so no consent URL was minted.
    const states = await t.run((ctx) =>
      ctx.db.query("calendarOAuthStates").collect(),
    );
    expect(states).toHaveLength(0);
  });

  test("says exactly what is missing when the deployment isn't configured", async () => {
    const t = fresh();
    const { userId, as } = await account(t);

    delete process.env.GOOGLE_CLIENT_ID;
    await expect(
      as.action(api.calendar.connections.startConnect, {}),
    ).rejects.toThrow(CALENDAR.configuredMissing);

    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    delete process.env.CALENDAR_TOKEN_KEY;
    await expect(
      as.action(api.calendar.connections.startConnect, {}),
    ).rejects.toThrow(CALENDAR.keyMissing);

    // Nothing was written while the deployment couldn't seal credentials.
    const states = await t.run((ctx) => ctx.db.query("calendarOAuthStates").collect());
    expect(states).toHaveLength(0);
    expect(userId).toBeTruthy();
  });

  test("builds a PKCE consent URL and stores only a hash of the state", async () => {
    const t = fresh();
    const { as } = await account(t);

    const { url } = await as.action(api.calendar.connections.startConnect, {});
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;

    expect(parsed.origin + parsed.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(parsed.searchParams.get("client_id")).toBe(
      "test-client-id.apps.googleusercontent.com",
    );
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://nexa-test.convex.site/oauth/calendar/callback",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    // The narrowest calendar scope, and no full-calendar access.
    expect(parsed.searchParams.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
    expect(parsed.searchParams.get("scope")).not.toContain("auth/calendar ");
    expect(parsed.searchParams.get("scope")).not.toContain(
      "https://www.googleapis.com/auth/calendar.events ",
    );
    expect(parsed.searchParams.get("client_secret")).toBeNull();

    const states = await t.run((ctx) => ctx.db.query("calendarOAuthStates").collect());
    expect(states).toHaveLength(1);
    expect(states[0].stateHash).toBe(await sha256Hex(state));
    // The raw state is never persisted, and the verifier is sealed.
    expect(JSON.stringify(states[0])).not.toContain(state);
    expect(states[0].codeVerifierEnc.startsWith("v1.")).toBe(true);
    expect(states[0].redirectTo).toBe("https://nexameet.in/dashboard");
  });

  test("the callback exchanges the code, seals the tokens, and connects", async () => {
    const t = fresh();
    const { as } = await account(t);

    const { url } = await as.action(api.calendar.connections.startConnect, {});
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;
    const challenge = parsed.searchParams.get("code_challenge")!;

    const response = await t.fetch(
      `/oauth/calendar/callback?state=${encodeURIComponent(state)}&code=test-code`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://nexameet.in/dashboard?calendar=connected&provider=google",
    );

    // The verifier that we kept server-side must be the one committed to in
    // the challenge — that pairing is the whole point of PKCE.
    const tokenCalls = google.requestsTo("/token");
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].body.grant_type).toBe("authorization_code");
    expect(tokenCalls[0].body.code).toBe("test-code");
    expect(tokenCalls[0].body.redirect_uri).toBe(
      "https://nexa-test.convex.site/oauth/calendar/callback",
    );
    const verifier = String(tokenCalls[0].body.code_verifier ?? "");
    expect(verifier.length).toBeGreaterThan(40);
    expect(await sha256Base64Url(verifier)).toBe(challenge);

    const connection = await connectionRow(t);
    expect(connection?.status).toBe("connected");
    expect(connection?.accountEmail).toBe("person@nexameet.in");
    expect(connection?.scopes).toContain(
      "https://www.googleapis.com/auth/calendar.events.owned",
    );
    // Sealed, not stored: the raw token must not be readable in the row.
    expect(connection?.accessTokenEnc?.startsWith("v1.")).toBe(true);
    expect(connection?.refreshTokenEnc?.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(connection)).not.toContain("access-1");

    // The state is spent, so it cannot be replayed.
    const states = await t.run((ctx) => ctx.db.query("calendarOAuthStates").collect());
    expect(states[0].consumedAt).toBeGreaterThan(0);
  });

  test("falls back to userinfo when the id_token carries no address", async () => {
    const t = fresh();
    const { as } = await account(t);
    google.omitEmailFromIdToken = true;

    const { url } = await as.action(api.calendar.connections.startConnect, {});
    const state = new URL(url).searchParams.get("state")!;
    await t.fetch(`/oauth/calendar/callback?state=${state}&code=test-code`);

    expect(google.requestsTo("/v1/userinfo")).toHaveLength(1);
    expect((await connectionRow(t))?.accountEmail).toBe("person@nexameet.in");
  });

  test("a replayed callback is refused and connects nothing twice", async () => {
    const t = fresh();
    const { as } = await account(t);
    const { url } = await as.action(api.calendar.connections.startConnect, {});
    const state = new URL(url).searchParams.get("state")!;

    await t.fetch(`/oauth/calendar/callback?state=${state}&code=first`);
    const replay = await t.fetch(`/oauth/calendar/callback?state=${state}&code=second`);

    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toContain("calendar=error");
    expect(replay.headers.get("location")).toContain("reason=state");
    // Only the first callback reached the token endpoint.
    expect(google.requestsTo("/token")).toHaveLength(1);
  });

  test("an unknown state is refused without touching Google", async () => {
    const t = fresh();
    const response = await t.fetch(
      "/oauth/calendar/callback?state=not-a-real-state&code=test-code",
    );
    expect(response.headers.get("location")).toBe(
      "https://nexameet.in/dashboard?calendar=error&reason=state",
    );
    expect(google.requests).toHaveLength(0);
  });

  test("declining consent is reported honestly and stores nothing", async () => {
    const t = fresh();
    const { as } = await account(t);
    const { url } = await as.action(api.calendar.connections.startConnect, {});
    const state = new URL(url).searchParams.get("state")!;

    const response = await t.fetch(
      `/oauth/calendar/callback?state=${state}&error=access_denied`,
    );
    expect(response.headers.get("location")).toContain("reason=denied");
    expect(google.requests).toHaveLength(0);
    expect(await connectionRow(t)).toBeNull();
  });

  test("a callback redirects only to our own origin", async () => {
    const t = fresh();
    const { as } = await account(t);

    // An absolute URL is ignored outright — no open redirect.
    const hostile = await as.action(api.calendar.connections.startConnect, {
      returnTo: "https://evil.example/steal",
    });
    const hostileState = new URL(hostile.url).searchParams.get("state")!;
    const hostileResponse = await t.fetch(
      `/oauth/calendar/callback?state=${hostileState}&code=test-code`,
    );
    expect(hostileResponse.headers.get("location")).toMatch(
      /^https:\/\/nexameet\.in\/dashboard\?calendar=connected/,
    );

    // A path on our origin is honoured, including its own query.
    const ok = await as.action(api.calendar.connections.startConnect, {
      returnTo: "/dashboard?tab=calendar",
    });
    const okState = new URL(ok.url).searchParams.get("state")!;
    const okResponse = await t.fetch(
      `/oauth/calendar/callback?state=${okState}&code=test-code`,
    );
    expect(okResponse.headers.get("location")).toBe(
      "https://nexameet.in/dashboard?tab=calendar&calendar=connected&provider=google",
    );

    // Protocol-relative URLs are refused too.
    const sneaky = await as.action(api.calendar.connections.startConnect, {
      returnTo: "//evil.example",
    });
    const sneakyState = new URL(sneaky.url).searchParams.get("state")!;
    const sneakyResponse = await t.fetch(
      `/oauth/calendar/callback?state=${sneakyState}&code=test-code`,
    );
    expect(sneakyResponse.headers.get("location")).toMatch(
      /^https:\/\/nexameet\.in\/dashboard\?calendar=connected/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Scheduling
 * ------------------------------------------------------------------ */

describe("scheduling into a calendar", () => {
  test("creates one event, linked to the Nexa meeting", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code, startsAt } = await book(t, as);

    const outcome = await as.action(api.calendar.sync.syncMeeting, { code });
    expect(outcome.status).toBe("synced");
    expect(outcome.htmlLink).toContain("calendar.google.com");

    const created = google.requestsTo("/events");
    expect(created).toHaveLength(1);
    const body = created[0].body as Record<string, never>;
    expect(created[0].method).toBe("POST");
    expect(created[0].query.get("sendUpdates")).toBe("all");
    expect(body.summary as unknown as string).toBe("Design review");
    expect(body.location as unknown as string).toBe(
      `https://nexameet.in/m/${code.replace(/(.{4})(?=.)/g, "$1-")}`,
    );
    expect(body.description as unknown as string).toContain("Join the Nexa meeting");
    expect(body.attendees).toEqual([{ email: "priya@example.test" }]);
    const start = body.start as unknown as { dateTime: string; timeZone: string };
    const end = body.end as unknown as { dateTime: string; timeZone: string };
    expect(start.timeZone).toBe("Asia/Kolkata");
    expect(start.dateTime).toMatch(/\+05:30$/);
    // 45 minutes, expressed in the same zone.
    expect(Date.parse(end.dateTime)).toBe(
      Date.parse(start.dateTime) + 45 * 60_000,
    );
    expect(startsAt).toBeGreaterThan(0);

    const row = await linkRow(t);
    expect(row?.syncStatus).toBe("synced");
    expect(row?.externalEventId).toBe(google.events.keys().next().value);
    expect(row?.attempts).toBe(1);
    expect(row?.lastSyncedAt).toBeGreaterThan(0);
    expect(row?.desired.joinUrl).toContain("/m/");
    // Guest addresses are not duplicated anywhere they don't belong.
    expect(JSON.stringify(row)).not.toContain("access-1");
  });

  test("rescheduling patches the same event instead of making a second one", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code, startsAt } = await book(t, as);
    await as.action(api.calendar.sync.syncMeeting, { code });

    const movedTo = startsAt + 86_400_000;
    await as.mutation(api.schedule.reschedule, {
      code,
      startsAt: movedTo,
      durationMinutes: 60,
      title: "Design review (moved)",
    });
    const outcome = await as.action(api.calendar.sync.syncMeeting, { code });

    expect(outcome.status).toBe("synced");
    // Still exactly one event, updated in place.
    expect(google.events.size).toBe(1);
    expect(google.requestsTo("/events").filter((r) => r.method === "POST")).toHaveLength(1);
    const patches = google.requestsTo("/events").filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    const patched = [...google.events.values()][0] as Record<string, unknown>;
    expect(patched.summary).toBe("Design review (moved)");
    const start = patched.start as { dateTime: string };
    const end = patched.end as { dateTime: string };
    expect(Date.parse(end.dateTime) - Date.parse(start.dateTime)).toBe(60 * 60_000);
  });

  test("a create whose response was lost is reconciled, not duplicated", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);

    // Google commits the event, then the connection dies before we hear back.
    google.failNext("POST /calendar/v3", { mode: "afterNetwork" });
    const first = await as.action(api.calendar.sync.syncMeeting, { code });
    expect(first.status).toBe("pending");
    expect((await linkRow(t))?.syncStatus).toBe("pending");
    // The provider does have the event, even though we were told nothing.
    expect(google.events.size).toBe(1);

    const second = await as.action(api.calendar.sync.syncMeeting, { code });
    expect(second.status).toBe("synced");
    // One event, confirmed by reading it back after the 409 conflict.
    expect(google.events.size).toBe(1);
    expect(google.requestsTo("/events").filter((r) => r.method === "GET")).toHaveLength(1);
    const row = await linkRow(t);
    expect(row?.syncStatus).toBe("synced");
    expect(row?.externalEventId).toBe(google.events.keys().next().value);
  });

  test("two simultaneous requests still produce one event", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);

    const [a, b] = await Promise.all([
      as.action(api.calendar.sync.syncMeeting, { code }),
      as.action(api.calendar.sync.syncMeeting, { code }),
    ]);

    expect([a.status, b.status].every((status) => status === "synced")).toBe(true);
    expect(google.events.size).toBe(1);
    expect(await t.run((ctx) => ctx.db.query("calendarEvents").collect())).toHaveLength(1);
  });

  test("recreating an event deleted outside Nexa repairs the link", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);
    await as.action(api.calendar.sync.syncMeeting, { code });

    // Someone deletes the event in Google Calendar itself.
    google.events.clear();
    const outcome = await as.action(api.calendar.sync.syncMeeting, { code });

    expect(outcome.status).toBe("synced");
    expect(google.events.size).toBe(1);
    expect((await linkRow(t))?.syncStatus).toBe("synced");
  });

  test("a transient outage is retried on its own until it succeeds", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);

    // Fake timers are installed before the attempt so the retry this arms can
    // be advanced deliberately rather than waited out.
    vi.useFakeTimers();
    try {
      google.failNext("POST /calendar/v3", { mode: "status", status: 503 });
      const outcome = await as.action(api.calendar.sync.syncMeeting, { code });
      expect(outcome.status).toBe("pending");
      expect(outcome.message).toBe(CALENDAR.retrying);

      const pending = await linkRow(t);
      expect(pending?.syncStatus).toBe("pending");
      expect(pending?.attempts).toBe(1);
      expect(pending?.nextAttemptAt).toBeGreaterThan(Date.now());
      expect(pending?.lastSyncedAt).toBeUndefined();
      expect(google.events.size).toBe(0);

      // The backoff comes due and the retry runs on its own — no user action,
      // no second click.
      vi.advanceTimersByTime(60_000);
      await t.finishInProgressScheduledFunctions();
    } finally {
      vi.useRealTimers();
    }

    const settled = await linkRow(t);
    expect(settled?.syncStatus).toBe("synced");
    expect(google.events.size).toBe(1);
    expect(settled?.attempts).toBe(2);
  });

  test("the reconciler re-arms a sync whose retry was lost", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);
    await as.action(api.calendar.sync.syncMeeting, { code });

    // Simulate a booking that was left mid-flight with no job to run it:
    // an over-due attempt and an event that doesn't exist on the provider.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("calendarEvents").first();
      await ctx.db.patch(row!._id, {
        syncStatus: "pending",
        externalEventId: undefined,
        nextAttemptAt: Date.now() - 60_000,
        attempts: 1,
      });
    });
    google.events.clear();

    const result = await t.mutation(internal.calendar.sync.reconcilePending, {});
    expect(result.scheduled).toBe(1);
    await t.finishAllScheduledFunctions(() => {});
    expect((await linkRow(t))?.syncStatus).toBe("synced");
    expect(google.events.size).toBe(1);
  });

  test("stops after the attempt limit and says so instead of looping", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);

    google.failNext("POST /calendar/v3", { mode: "network", times: 30 });
    const first = await as.action(api.calendar.sync.syncMeeting, { code });
    expect(google.events.size).toBe(0);
    expect(first.status).toBe("pending");
    const linkId = (await linkRow(t))!._id;

    // Drive the same path the scheduler would, one attempt at a time.
    for (let i = 0; i < 10; i++) {
      await t.action(internal.calendar.sync.retrySync, { linkId });
    }
    const exhausted = await linkRow(t);
    expect(exhausted?.attempts).toBeGreaterThanOrEqual(8);
    expect(exhausted?.syncStatus).toBe("failed");
    // No further automatic retry is armed once it has given up.
    expect(exhausted?.nextAttemptAt).toBeUndefined();

    // The user pressing Retry clears the gave-up state and works. Google is
    // healthy again by then.
    google.stopFailing();
    const recovered = await as.action(api.calendar.sync.syncMeeting, {
      code,
      force: true,
    });
    expect(recovered.status).toBe("synced");
    expect(google.events.size).toBe(1);
  });

  test("an expired access token is refreshed before the call", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await t.run(async (ctx) => {
      const connection = await ctx.db.query("calendarConnections").first();
      void connection;
    });
    await connect(t, userId);
    // Expire it, as if Nexa had been idle for an hour.
    await t.run(async (ctx) => {
      const connection = await ctx.db.query("calendarConnections").first();
      await ctx.db.patch(connection!._id, { accessTokenExpiresAt: Date.now() - 1000 });
    });
    const { code } = await book(t, as);

    const outcome = await as.action(api.calendar.sync.syncMeeting, { code });
    expect(outcome.status).toBe("synced");

    const refreshes = google.requestsTo("/token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].body.grant_type).toBe("refresh_token");
    expect(refreshes[0].body.refresh_token).toBe("refresh-1");
    // The refreshed token was sealed and stored, never returned.
    const connection = await connectionRow(t);
    expect(connection?.accessTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(connection?.accessTokenEnc?.startsWith("v1.")).toBe(true);
  });

  test("a revoked grant asks the user to reconnect and does not retry blindly", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    await t.run(async (ctx) => {
      const connection = await ctx.db.query("calendarConnections").first();
      await ctx.db.patch(connection!._id, { accessTokenExpiresAt: Date.now() - 1000 });
    });
    google.refreshInvalid = true;
    const { code } = await book(t, as);

    const outcome = await as.action(api.calendar.sync.syncMeeting, { code });
    expect(outcome.status).toBe("needs_reauth");
    expect(outcome.message).toBe(CALENDAR.needsReauth);

    expect((await connectionRow(t))?.status).toBe("needs_reauth");
    const row = await linkRow(t);
    expect(row?.syncStatus).toBe("failed");
    expect(row?.needsReauth).toBe(true);
    expect(google.requestsTo("/events")).toHaveLength(0);

    // The status card now tells the user what to do.
    const status = await as.query(api.calendar.connections.status, {});
    expect(status.providers[0].status).toBe("needs_reauth");
  });

  test("a permanent refusal fails once and is not retried", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);

    google.failNext("POST /calendar/v3", {
      mode: "status",
      status: 403,
      body: { error: { message: "Forbidden", errors: [{ reason: "forbidden" }] } },
    });
    const outcome = await as.action(api.calendar.sync.syncMeeting, { code });

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toBe(CALENDAR.failed);
    const row = await linkRow(t);
    expect(row?.syncStatus).toBe("failed");
    expect(row?.nextAttemptAt).toBeUndefined();
    expect(google.requestsTo("/events").filter((r) => r.method === "POST")).toHaveLength(1);
  });

  test("a not-connected host is told so without calling Google", async () => {
    const t = fresh();
    const { as } = await account(t);
    const { code } = await book(t, as);

    const outcome = await as.action(api.calendar.sync.syncMeeting, { code });
    expect(outcome.status).toBe("not_connected");
    expect(google.requests).toHaveLength(0);
    expect(await linkRow(t)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Cancelling
 * ------------------------------------------------------------------ */

describe("cancelling", () => {
  test("removes the calendar event and stays idempotent", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);
    await as.action(api.calendar.sync.syncMeeting, { code });
    expect(google.events.size).toBe(1);

    await as.mutation(api.schedule.cancel, { code });
    const first = await as.action(api.calendar.sync.cancelForBooking, { code });
    expect(first.status).toBe("cancelled");
    expect(google.events.size).toBe(0);

    // A second cancel is a no-op that still reports the truth, and — this is
    // the important part — it does not recreate the event.
    const second = await as.action(api.calendar.sync.cancelForBooking, { code });
    expect(second.status).toBe("cancelled");
    expect(google.events.size).toBe(0);
    expect(google.requestsTo("/events").filter((r) => r.method === "POST")).toHaveLength(1);

    const row = await linkRow(t);
    expect(row?.syncStatus).toBe("cancelled");
    expect(row?.cancelledAt).toBeGreaterThan(0);
  });

  test("cancels an event that was created but never confirmed", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);

    // The create committed at Google but we never saw the response.
    google.failNext("POST /calendar/v3", { mode: "afterNetwork" });
    await as.action(api.calendar.sync.syncMeeting, { code });
    expect(google.events.size).toBe(1);

    await as.mutation(api.schedule.cancel, { code });
    const outcome = await as.action(api.calendar.sync.cancelForBooking, { code });
    expect(outcome.status).toBe("cancelled");
    // Our own event id was enough to delete it, so nothing outlives the room.
    expect(google.events.size).toBe(0);
  });

  test("a cancelled booking cannot be rescheduled", async () => {
    const t = fresh();
    const { as } = await account(t);
    const { code } = await book(t, as);
    await as.mutation(api.schedule.cancel, { code });

    await expect(
      as.mutation(api.schedule.reschedule, {
        code,
        startsAt: Date.now() + 7_200_000,
      }),
    ).rejects.toThrow(SCHEDULING.notFound);
  });

  test("cancelling a booking that was never linked is not an error", async () => {
    const t = fresh();
    const { as } = await account(t);
    const { code } = await book(t, as);
    await as.mutation(api.schedule.cancel, { code });

    const outcome = await as.action(api.calendar.sync.cancelForBooking, { code });
    expect(outcome.status).toBe("not_connected");
    expect(google.requests).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Authorization and privacy
 * ------------------------------------------------------------------ */

describe("authorization and privacy", () => {
  test("another account cannot schedule, sync, or cancel someone else's booking", async () => {
    const t = fresh();
    const host = await account(t, HOST, "Host");
    await connect(t, host.userId);
    const { code } = await book(t, host.as);
    await host.as.action(api.calendar.sync.syncMeeting, { code });

    const stranger = await account(t, STRANGER, "Thief");
    await expect(
      stranger.as.action(api.calendar.sync.syncMeeting, { code }),
    ).rejects.toThrow(SCHEDULING.notFound);
    await expect(
      stranger.as.action(api.calendar.sync.cancelForBooking, { code }),
    ).rejects.toThrow(SCHEDULING.notFound);
    await expect(
      stranger.as.mutation(api.schedule.cancel, { code }),
    ).rejects.toThrow(SCHEDULING.notFound);
    await expect(
      stranger.as.mutation(api.schedule.reschedule, {
        code,
        startsAt: Date.now() + 3_600_000,
      }),
    ).rejects.toThrow(SCHEDULING.notFound);

    // The provider was never touched, and the stranger sees no links.
    expect(google.requestsTo("/events")).toHaveLength(1);
    expect(await stranger.as.query(api.calendar.connections.listLinks, {})).toEqual([]);
    expect((await linkRow(t))?.syncStatus).toBe("synced");
  });

  test("the status query never exposes credentials", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId, "super-secret-access-token");
    const { code } = await book(t, as);
    await as.action(api.calendar.sync.syncMeeting, { code });

    const status = await as.query(api.calendar.connections.status, {});
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("super-secret-access-token");
    expect(serialized).not.toContain("refresh-1");
    expect(serialized).not.toContain("Enc");
    expect(serialized).not.toContain("Token");
    expect(status.providers[0].accountEmail).toBe("person@nexameet.in");
    expect(status.ready).toBe(true);
    // A real account, so the card offers the provider itself.
    expect(status.requiresSignIn).toBe(false);

    // The same for the booking-level list the scheduling UI reads.
    const links = await as.query(api.calendar.connections.listLinks, {});
    expect(JSON.stringify(links)).not.toContain("super-secret-access-token");
    expect(links[0].syncStatus).toBe("synced");
    expect(links[0].htmlLink).toContain("calendar.google.com");
  });

  test("a signed-out visitor learns nothing", async () => {
    const t = fresh();
    const status = await t.query(api.calendar.connections.status, {});
    expect(status.providers).toEqual([]);
    // With no session there is no account to attach a grant to, so the card
    // asks for a sign-in instead of a Connect button that would be refused.
    expect(status.requiresSignIn).toBe(true);
    expect(await t.query(api.calendar.connections.listLinks, {})).toEqual([]);
  });

  test("a guest is never told a calendar is connected", async () => {
    const t = fresh();
    const guestId = await t.run((ctx) =>
      ctx.db.insert("users", { isAnonymous: true, nexaId: "NX-GUEST3" }),
    );
    // A connection dating from before this rule existed: it is invisible to a
    // guest rather than reported as Connected next to a blocked schedule form.
    await connect(t, guestId);
    const as = t.withIdentity({ subject: guestId });

    const status = await as.query(api.calendar.connections.status, {});
    expect(status.requiresSignIn).toBe(true);
    expect(status.providers).toEqual([]);
    expect(status.reason).toBe(CALENDAR.guestNeedsSignIn);
    expect(JSON.stringify(status)).not.toContain("person@nexameet.in");
  });

  test("an account with no address cannot own a connection either", async () => {
    const t = fresh();
    const noEmailId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "No address", nexaId: "NX-NOEMAIL" }),
    );
    const as = t.withIdentity({ subject: noEmailId });

    const status = await as.query(api.calendar.connections.status, {});
    expect(status.requiresSignIn).toBe(true);
    await expect(
      as.action(api.calendar.connections.startConnect, {}),
    ).rejects.toThrow(CALENDAR.guestNeedsSignIn);
  });

  test("scheduling requires a real account, not an anonymous guest", async () => {
    const t = fresh();
    const guestId = await t.run((ctx) =>
      ctx.db.insert("users", { isAnonymous: true, nexaId: "NX-GUEST1" }),
    );
    await expect(
      t.withIdentity({ subject: guestId }).mutation(api.schedule.schedule, {
        startsAt: Date.now() + 3_600_000,
        invitees: ["someone@example.test"],
      }),
    ).rejects.toThrow(SCHEDULING.guestsBlocked);
  });
});

/* ------------------------------------------------------------------ *
 * Disconnecting
 * ------------------------------------------------------------------ */

describe("disconnecting", () => {
  test("revokes at Google, forgets the tokens, and stops waiting syncs", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);

    // One booking mid-flight, so disconnecting has something to stop.
    google.failNext("POST /calendar/v3", { mode: "status", status: 503 });
    await as.action(api.calendar.sync.syncMeeting, { code });
    expect((await linkRow(t))?.syncStatus).toBe("pending");

    const result = await as.action(api.calendar.connections.disconnect, {});
    expect(result).toEqual({ ok: true, revoked: true });

    // Google was told, and our copy of the grant is gone.
    expect(google.requestsTo("/revoke")).toHaveLength(1);
    const connection = await connectionRow(t);
    expect(connection?.status).toBe("revoked");
    expect(connection?.accessTokenEnc).toBeUndefined();
    expect(connection?.refreshTokenEnc).toBeUndefined();
    expect(connection?.accessTokenExpiresAt).toBeUndefined();
    expect(connection?.disconnectedAt).toBeGreaterThan(0);

    const row = await linkRow(t);
    expect(row?.syncStatus).toBe("failed");
    expect(row?.needsReauth).toBe(true);
    expect(row?.nextAttemptAt).toBeUndefined();
    expect(row?.lastError).toBe(CALENDAR.needsReauth);

    // And a later sync attempt says "connect a calendar" rather than failing.
    const outcome = await as.action(api.calendar.sync.syncMeeting, { code });
    expect(outcome.status).toBe("not_connected");
  });

  test("disconnecting leaves already-created events alone", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);
    await as.action(api.calendar.sync.syncMeeting, { code });
    const eventId = google.events.keys().next().value;

    await as.action(api.calendar.connections.disconnect, {});

    // The event is still in the user's calendar; Nexa just stops managing it.
    expect(google.events.has(eventId!)).toBe(true);
    const row = await linkRow(t);
    expect(row?.syncStatus).toBe("synced");
    expect(row?.externalEventId).toBe(eventId);
    expect(row?.cancelledAt).toBeUndefined();
  });

  test("disconnecting twice changes nothing", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);

    await as.action(api.calendar.connections.disconnect, {});
    const again = await as.action(api.calendar.connections.disconnect, {});
    expect(again).toEqual({ ok: true, revoked: false });
    // A second disconnect has no token to revoke, so Google isn't called again.
    expect(google.requestsTo("/revoke")).toHaveLength(1);
  });

  test("a revoked connection can be reconnected and resumes syncing", async () => {
    const t = fresh();
    const { userId, as } = await account(t);
    await connect(t, userId);
    const { code } = await book(t, as);
    await as.action(api.calendar.connections.disconnect, {});

    // Fresh consent, exactly as the callback would store it.
    await t.run(async (ctx) => {
      const connection = await ctx.db.query("calendarConnections").first();
      await ctx.db.patch(connection!._id, {
        status: "connected",
        accessTokenEnc: await encryptSecret("access-2"),
        refreshTokenEnc: await encryptSecret("refresh-2"),
        accessTokenExpiresAt: Date.now() + 3_600_000,
        disconnectedAt: undefined,
      });
    });

    const outcome = await as.action(api.calendar.sync.syncMeeting, {
      code,
      force: true,
    });
    expect(outcome.status).toBe("synced");
    expect(google.events.size).toBe(1);
    const status = await as.query(api.calendar.connections.status, {});
    expect(status.providers[0].status).toBe("connected");
  });
});
