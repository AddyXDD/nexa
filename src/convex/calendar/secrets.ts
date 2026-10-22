import { ConvexError } from "convex/values";
import { CALENDAR } from "../../shared/constants";

/**
 * Credential encryption for calendar connections.
 *
 * A refresh token is standing access to somebody's calendar, so it is the one
 * thing this feature must never store in the clear. Tokens are sealed with
 * AES-256-GCM under a key that lives only in the deployment environment
 * (`CALENDAR_TOKEN_KEY`), which means a database read — a leaked row, a
 * support export, a query that over-shares — yields ciphertext and nothing
 * else. Only actions and http actions ever decrypt, and nothing logs a value
 * that comes out of here.
 *
 * Everything in this file needs WebCrypto (`crypto.subtle`), which the Convex
 * runtime provides; `crypto.getRandomValues` alone is available in mutations.
 */

const KEY_ENV = "CALENDAR_TOKEN_KEY";
/** Bumped if the scheme ever changes, so old rows stay decryptable. */
const KEY_VERSION = 1;
const IV_BYTES = 12; // 96-bit nonce, the size AES-GCM is specified around
const TAG_BITS = 128;
/** Bound into the ciphertext so a sealed value can't be replayed as another. */
const AAD = new TextEncoder().encode("nexa-calendar-credentials-v1");

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== null) out += B64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== null) out += B64URL[b2 & 0x3f];
  }
  return out;
}

export function base64UrlDecode(text: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = B64URL.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Accept the key as base64, base64url, or hex — whatever `openssl rand`
 * produced — and insist on exactly 32 bytes. A short key silently weakening
 * every stored credential is worse than refusing to start.
 */
function parseKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  const fromHex = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? new Uint8Array(
        trimmed.match(/.{2}/g)!.map((pair) => parseInt(pair, 16)),
      )
    : null;
  // `openssl rand -base64 32` emits *standard* base64, which routinely
  // contains `+` and `/`. The decoder is the URL-safe alphabet, so fold those
  // two characters in rather than letting it skip them — skipping would drop
  // bytes and turn a perfectly good key into "the key is missing".
  const key =
    fromHex ??
    base64UrlDecode(
      trimmed.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"),
    );
  if (key.length !== 32) throw new ConvexError(CALENDAR.keyMissing);
  return key;
}

export function requireEncryptionKey(): Uint8Array {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.trim().length === 0) throw new ConvexError(CALENDAR.keyMissing);
  return parseKey(raw);
}

async function importKey(key: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** `v1.<iv>.<ciphertext+tag>`, all base64url. */
export async function encryptSecret(
  plaintext: string,
  key: Uint8Array = requireEncryptionKey(),
): Promise<string> {
  const iv = new Uint8Array(new ArrayBuffer(IV_BYTES));
  crypto.getRandomValues(iv);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: TAG_BITS, additionalData: AAD },
    await importKey(key),
    new TextEncoder().encode(plaintext),
  );
  return [
    `v${KEY_VERSION}`,
    base64UrlEncode(iv),
    base64UrlEncode(new Uint8Array(sealed)),
  ].join(".");
}

/**
 * Open a sealed value. Throws for anything malformed, truncated, or sealed
 * with a different key — a tampered token must fail loudly rather than turn
 * into a confusing API error later.
 */
export async function decryptSecret(
  payload: string,
  key: Uint8Array = requireEncryptionKey(),
): Promise<string> {
  const [version, ivPart, dataPart] = payload.split(".");
  if (version !== `v${KEY_VERSION}` || !ivPart || !dataPart) {
    throw new Error("Unrecognized credential payload.");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlDecode(ivPart) as unknown as BufferSource,
      tagLength: TAG_BITS,
      additionalData: AAD,
    },
    await importKey(key),
    base64UrlDecode(dataPart) as unknown as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

/** SHA-256 as base64url — the encoding PKCE's S256 challenge requires. */
export async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A URL-safe, unguessable token (OAuth state, PKCE verifier). */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(new ArrayBuffer(bytes));
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

/**
 * 160-bit id over Google's base32hex alphabet (lowercase a–v, 0–9). Google
 * accepts a caller-supplied event id in exactly this form, which is what
 * makes event creation idempotent: the id is chosen once, stored, and reused
 * on every retry.
 */
export function randomBase32Hex(length: number): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Length-independent comparison, so a secret can't be probed byte by byte. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
