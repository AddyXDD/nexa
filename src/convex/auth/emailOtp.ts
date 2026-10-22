import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { Resend } from "resend";
import { SUPPORT_EMAIL } from "../../shared/constants";

/** Code lifetime in minutes. The email copy below quotes the same number. */
const OTP_EXPIRY_MINUTES = 15;

const OTP_SUBJECT = "Your Nexa Meet sign-in code";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * OTP_EXPIRY_MINUTES,
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    // Branded mail is used only when the deployment carries both Resend
    // variables. Otherwise codes keep going through the gateway below, so
    // unsetting either variable is a complete rollback — token generation,
    // expiry and verification above and below this callback are identical
    // in both cases.
    const from = resendSender();
    if (from !== null) {
      try {
        await sendResendOtp(from, email, token);
      } catch (error) {
        throw resendOtpError(error);
      }
      return;
    }
    try {
      await axios.post(
        freebuffEmailOtpUrl(),
        { to: email, otp: token },
        { headers: freebuffEmailOtpHeaders() },
      );
    } catch (error) {
      throw freebuffEmailOtpError(error);
    }
  },
});

// Sign-in codes are sent by the Freebuff integrations gateway, which knows
// this project by its own key: VLY_INTEGRATION_KEY, a Convex environment
// variable set when the project was created. The email's wording is fixed by
// the gateway.
function freebuffEmailOtpUrl(): string {
  const base =
    process.env.VLY_INTEGRATION_BASE_URL || "https://integrations.vly.ai";
  return `${base.replace(/\/+$/, "")}/v1/email/otp`;
}

function freebuffEmailOtpHeaders(): Record<string, string> {
  const key = process.env.VLY_INTEGRATION_KEY;
  if (!key) {
    throw new Error(
      "VLY_INTEGRATION_KEY is not set on this Convex deployment, so email sign-in cannot send codes.",
    );
  }
  return { Authorization: `Bearer ${key}` };
}

// Never stringify the whole request error: it carries the request headers.
function freebuffEmailOtpError(error: unknown): Error {
  const response = (
    error as { response?: { status?: number; data?: { error?: unknown } } }
  )?.response;
  if (response) {
    const detail =
      typeof response.data?.error === "string" ? `: ${response.data.error}` : "";
    return new Error(
      `Could not send the sign-in code (HTTP ${response.status})${detail}`,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Could not send the sign-in code: ${message}`);
}

/* ------------------------------------------------------------------ *
 * Branded sending — Resend
 * ------------------------------------------------------------------ */

// Branded sending needs both variables: the key and the From address. A
// missing or half-configured Resend setup must fall through to the gateway
// rather than fail, so sign-in never depends on one transport existing.
function resendSender(): string | null {
  const from = process.env.RESEND_EMAIL_FROM?.trim();
  if (!process.env.RESEND_API_KEY || !from) return null;
  return from;
}

async function sendResendOtp(
  from: string,
  to: string,
  code: string,
): Promise<void> {
  // Constructed per send so the key is read only from the deployment
  // environment — never from arguments, logs, or a committed file.
  const resend = new Resend(process.env.RESEND_API_KEY);
  // The SDK resolves to { data, error } instead of throwing on API errors,
  // so failures are turned into an Error here, with the same scrubbing the
  // gateway path uses.
  const { error } = await resend.emails.send({
    from,
    to,
    replyTo: SUPPORT_EMAIL,
    subject: OTP_SUBJECT,
    text: otpEmailText(code),
    html: otpEmailHtml(code),
  });
  if (error) {
    // Keep Resend's own name ("validation_error", "missing_required_field",
    // …) on the thrown Error so the scrubber below can report it verbatim.
    const failure = new Error(error.message);
    failure.name = error.name;
    throw failure;
  }
}

// Neither the SDK's { name, message } error nor a thrown transport failure
// may be stringified whole, and neither ever carries the code or the key —
// only the two descriptive fields are echoed, in the gateway's style. A
// plain thrown Error keeps the gateway's simpler wording, so only the SDK's
// own error names are reported as a code.
function resendOtpError(error: unknown): Error {
  const api = error as { name?: string; message?: string };
  if (
    typeof api?.name === "string" &&
    typeof api?.message === "string" &&
    api.name !== "Error"
  ) {
    return new Error(
      `Could not send the sign-in code (${api.name}): ${api.message}`,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Could not send the sign-in code: ${message}`);
}

const FONT =
  "ui-sans-serif,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO =
  "ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

function otpEmailText(code: string): string {
  return [
    "Your Nexa Meet sign-in code",
    "",
    code,
    "",
    `This code expires in ${OTP_EXPIRY_MINUTES} minutes and can only be used once.`,
    "",
    "You are receiving it because someone asked to sign in to Nexa Meet with this email address. If that was not you, ignore this message: the code expires on its own and nothing changes on your account.",
    "",
    `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    "",
    "Nexa Meet — private video meetings.",
  ].join("\n");
}

// Tables and inline styles only — no external assets, no webfont — so the
// layout holds in Gmail, Outlook and Apple Mail alike. `code` is the
// server-generated six-digit token above (digits only, never user input),
// so it needs no HTML escaping here.
function otpEmailHtml(code: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${OTP_SUBJECT}</title>
<style>
  @media (max-width: 520px) {
    .nexa-card { padding: 24px 20px !important; }
    .nexa-code { font-size: 24px !important; letter-spacing: 0.2em !important; padding: 12px 16px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#f6f5f1;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f6f5f1;">
    <tr>
      <td align="center" style="padding:32px 16px 40px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">
          <tr>
            <td style="padding:0 0 18px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="34" height="34" align="center" valign="middle" style="width:34px; height:34px; border-radius:9px; background-color:#191b1e; color:#a9bdf7; font-family:${FONT}; font-size:18px; font-weight:600; line-height:34px;">N</td>
                  <td style="padding-left:10px; font-family:${FONT}; font-size:15px; font-weight:600; letter-spacing:-0.01em; color:#14161a;">Nexa Meet</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="nexa-card" style="background-color:#ffffff; border:1px solid #e7e5de; border-radius:14px; padding:32px;">
              <p style="margin:0; font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#6d80e8;">Sign-in code</p>
              <h1 style="margin:10px 0 0; font-family:${FONT}; font-size:23px; line-height:1.25; font-weight:600; color:#14161a;">Your code to join Nexa Meet</h1>
              <p style="margin:14px 0 0; font-family:${FONT}; font-size:15px; line-height:1.6; color:#5b6068;">Enter this code on the sign-in screen to continue. Nobody at Nexa Meet will ever ask you for it.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 0;">
                <tr>
                  <td class="nexa-code" style="background-color:#f2f4fd; border:1px solid #dee3fb; border-radius:10px; padding:14px 20px; font-family:${MONO}; font-size:30px; font-weight:600; letter-spacing:0.26em; color:#2c3a99;">${code}</td>
                </tr>
              </table>
              <p style="margin:22px 0 0; font-family:${FONT}; font-size:13px; color:#6b7079;">This code expires in ${OTP_EXPIRY_MINUTES} minutes and can only be used once.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 2px 0; font-family:${FONT}; font-size:12px; line-height:1.65; color:#8b9099;">
              You are receiving this because someone asked to sign in to Nexa Meet with this email address. If that was not you, ignore this message — the code expires on its own and nothing changes on your account.<br>
              Questions? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#5b6068;">${SUPPORT_EMAIL}</a>.<br>
              <span style="color:#a3a8b0;">Nexa Meet — private video meetings.</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
