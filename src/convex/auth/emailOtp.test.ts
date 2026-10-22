import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { emailOtp } from "./emailOtp";
import { SUPPORT_EMAIL } from "../../shared/constants";

/**
 * The one place a code leaves the server.
 *
 * `sendVerificationRequest` decides which transport sends a sign-in code, so
 * these tests pin the two properties the rest of the sign-in flow depends on
 * and that a live send cannot be trusted to prove:
 *
 *  - Transport selection is decided purely by configuration. Both Resend
 *    variables set → the branded path. Either missing → the Freebuff gateway
 *    call exactly as before, so unsetting a variable is a complete rollback.
 *    A half-configured setup (key without a From address) must fall through
 *    rather than half-work.
 *  - A failed send surfaces only the API error's name and message. The code,
 *    the API key and the full error object must never reach an error the
 *    sign-in flow can display or log — and a failed branded send must not
 *    silently retry through the gateway, which could deliver two codes.
 *
 * No network: axios and the Resend SDK are mocked, and the environment is
 * set per test the way a deployment's environment would be.
 */

const { axiosPost, resendSend } = vi.hoisted(() => ({
  axiosPost: vi.fn(),
  resendSend: vi.fn(),
}));

vi.mock("axios", () => ({ default: { post: axiosPost } }));
vi.mock("resend", () => ({
  Resend: class {
    readonly emails = { send: resendSend };
  },
}));

const CODE = "123456";
const EMAIL = "person@example.test";
const RESEND_KEY = "re_test_key_must_not_leak";
const GATEWAY_KEY = "vly_test_key_must_not_leak";
const FROM = "Nexa Meet <support@nexameet.in>";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "RESEND_EMAIL_FROM",
  "VLY_INTEGRATION_KEY",
  "VLY_INTEGRATION_BASE_URL",
] as const;

let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  previousEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of ENV_KEYS) delete process.env[key];
  axiosPost.mockReset();
  resendSend.mockReset();
  resendSend.mockResolvedValue({ data: { id: "email-id" }, error: null });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** The arguments Convex Auth passes; the sender reads only email and token. */
function signInParams() {
  return {
    identifier: EMAIL,
    url: `https://app.test/auth?code=${CODE}`,
    expires: new Date(Date.now() + 60 * 60_000),
    provider: emailOtp,
    token: CODE,
    theme: {},
    request: new Request("http://localhost"),
  };
}

/**
 * What the sign-in action will actually use for the code's lifetime.
 *
 * `Email()` hands back an object with a hardcoded `maxAge` of one hour and
 * parks our config on `.options`; Convex Auth reconciles the two with
 * `merge(provider, provider.options)` before minting a code, so the value
 * that governs expiry is the merged one. Asserting against the un-merged
 * export would test the library's default, not this provider's setting.
 */
function effectiveMaxAgeSeconds(): number | undefined {
  const options = emailOtp.options as { maxAge?: number } | undefined;
  return options?.maxAge ?? emailOtp.maxAge;
}

/** Runs a send and returns the rejection, or null when nothing was thrown. */
async function sendAndCatch(): Promise<Error | null> {
  try {
    await emailOtp.sendVerificationRequest(signInParams());
    return null;
  } catch (thrown) {
    return thrown as Error;
  }
}

/** Whatever the mocked Resend SDK was handed, fully typed for assertions. */
function resendPayload(): {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
} {
  const payload = resendSend.mock.calls[0]?.[0];
  if (!payload) throw new Error("resend.emails.send was never called");
  return payload as {
    from: string;
    to: string;
    replyTo: string;
    subject: string;
    text: string;
    html: string;
  };
}

describe("branded Resend delivery", () => {
  test("sends the branded message when both Resend variables are set", async () => {
    process.env.RESEND_API_KEY = RESEND_KEY;
    process.env.RESEND_EMAIL_FROM = FROM;

    await emailOtp.sendVerificationRequest(signInParams());

    expect(axiosPost).not.toHaveBeenCalled();
    expect(resendSend).toHaveBeenCalledTimes(1);
    const payload = resendPayload();
    expect(payload).toMatchObject({
      from: FROM,
      to: EMAIL,
      replyTo: SUPPORT_EMAIL,
      subject: "Your Nexa Meet sign-in code",
    });
    // Both parts are required, and the code appears in both.
    expect(payload.text).toContain(CODE);
    expect(payload.html).toContain(CODE);
    // Self-contained: no external asset a mail client would have to fetch.
    expect(payload.html).not.toMatch(/https?:\/\//);
  });

  test("quotes the same expiry the provider enforces", async () => {
    process.env.RESEND_API_KEY = RESEND_KEY;
    process.env.RESEND_EMAIL_FROM = FROM;

    await emailOtp.sendVerificationRequest(signInParams());

    expect(effectiveMaxAgeSeconds()).toBe(15 * 60);
    const payload = resendPayload();
    const minutes = (effectiveMaxAgeSeconds() ?? 0) / 60;
    expect(payload.text).toContain(`expires in ${minutes} minutes`);
    expect(payload.html).toContain(`expires in ${minutes} minutes`);
  });
});

describe("gateway fallback", () => {
  test("a key without a From address still uses the gateway", async () => {
    process.env.VLY_INTEGRATION_KEY = GATEWAY_KEY;
    process.env.VLY_INTEGRATION_BASE_URL = "https://gw.test/";
    // Half-configured: the key alone must not switch transports.
    process.env.RESEND_API_KEY = RESEND_KEY;

    await emailOtp.sendVerificationRequest(signInParams());

    expect(resendSend).not.toHaveBeenCalled();
    expect(axiosPost).toHaveBeenCalledWith(
      "https://gw.test/v1/email/otp",
      { to: EMAIL, otp: CODE },
      { headers: { Authorization: `Bearer ${GATEWAY_KEY}` } },
    );
  });

  test("no Resend variables at all keeps the original call", async () => {
    process.env.VLY_INTEGRATION_KEY = GATEWAY_KEY;

    await emailOtp.sendVerificationRequest(signInParams());

    expect(resendSend).not.toHaveBeenCalled();
    expect(axiosPost).toHaveBeenCalledWith(
      "https://integrations.vly.ai/v1/email/otp",
      { to: EMAIL, otp: CODE },
      { headers: { Authorization: `Bearer ${GATEWAY_KEY}` } },
    );
  });
});

describe("failure handling", () => {
  test("an API error keeps only its name and message", async () => {
    process.env.RESEND_API_KEY = RESEND_KEY;
    process.env.RESEND_EMAIL_FROM = FROM;
    resendSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Domain not verified." },
    });

    const error = await sendAndCatch();

    expect(error?.message).toBe(
      "Could not send the sign-in code (validation_error): Domain not verified.",
    );
    // Neither the code nor the key may travel inside an error.
    expect(error?.message).not.toContain(CODE);
    expect(error?.message).not.toContain(RESEND_KEY);
    // A failed branded send must not also deliver through the gateway.
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test("a thrown transport failure is wrapped, not stringified whole", async () => {
    process.env.RESEND_API_KEY = RESEND_KEY;
    process.env.RESEND_EMAIL_FROM = FROM;
    // What the SDK throws on a network failure: an Error from the fetch layer.
    resendSend.mockRejectedValue(new Error("connect ECONNREFUSED 1.2.3.4:443"));

    const error = await sendAndCatch();

    expect(error?.message).toBe(
      "Could not send the sign-in code: connect ECONNREFUSED 1.2.3.4:443",
    );
    expect(error?.message).not.toContain(CODE);
    expect(axiosPost).not.toHaveBeenCalled();
  });
});
