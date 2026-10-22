#!/usr/bin/env bun
/**
 * Upload the packaged desktop installer to the public Vercel Blob store and
 * print the one URL the website needs.
 *
 * The installer is ~80MB and the web host rejects deploys over 60MB, so the
 * file can never live under `public/` — everything there is copied into the
 * deployment verbatim. Blob storage keeps it off the deployment entirely; the
 * site only ever renders a link to it.
 *
 * The read-write token is a secret and is used *here only*. Nothing under
 * `src/` imports this file or the Blob SDK, so no token and no upload code can
 * reach the browser bundle.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… bun run upload:installer
 *   bun run upload:installer --file release/Nexa-Meet-Setup.exe \
 *     --pathname downloads/Nexa-Meet-Setup.exe
 *
 * `bun run` loads `.env.local` automatically, so `vercel env pull` works too.
 */
import { createReadStream, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { put } from "@vercel/blob";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const file = resolve(flag("file", "release/Nexa-Meet-Setup.exe"));
const pathname = flag("pathname", `downloads/${basename(file)}`);

let size;
try {
  size = statSync(file).size;
} catch {
  console.error(`✖ No installer at ${file}`);
  console.error("  Build one first with `bun run desktop:dist`.");
  process.exit(1);
}

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("✖ BLOB_READ_WRITE_TOKEN is not set.");
  console.error(
    "  It is the read-write token for the `nexa-meet-blob` store, and it is a",
  );
  console.error("  secret — it never belongs in frontend code. Provide it by:");
  console.error("    • adding it in this project's Keys/API keys tab, or");
  console.error(
    "    • running `vercel env pull` (bun run loads .env.local), or",
  );
  console.error(
    "    • prefixing one command: BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… bun run upload:installer",
  );
  process.exit(1);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`Uploading ${basename(file)} (${mb(size)}) as ${pathname}…`);

const blob = await put(pathname, createReadStream(file), {
  access: "public",
  contentType: "application/octet-stream",
  // Split into parts and retry failed ones; matters at this size.
  multipart: true,
  // Stable URL across re-uploads, so the configured link never goes stale.
  addRandomSuffix: false,
  // Re-running replaces the previous installer instead of erroring.
  allowOverwrite: true,
});

console.log("\n✔ Uploaded.");
console.log(`  url          ${blob.url}`);
console.log(`  downloadUrl  ${blob.downloadUrl}`);
console.log(
  "\nNext: set this in the project's Keys/API keys tab, then redeploy:\n",
);
console.log(`  VITE_DESKTOP_DOWNLOAD_URL=${blob.downloadUrl}`);
console.log(
  '\nThe topbar\'s "Download app" button appears automatically once that variable is set.',
);
