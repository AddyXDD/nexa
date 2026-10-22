import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

/**
 * Nexa's privacy sweeper. One job, once a minute: it releases ghost seats,
 * closes rooms that have been empty past their grace period, drops expired
 * signalling/chat rows, and deletes ended meeting rows so no meeting history
 * accumulates. See cleanup.ts for what each pass destroys.
 */
const crons = cronJobs();
crons.interval("sweep ephemeral meeting state", { minutes: 5 }, api.cleanup.stale, {});

/**
 * Calendar reconciliation. Scheduled retries already cover a failed Google
 * call, but a scheduled job can be lost (deployment restart, expired lease,
 * an isolate that died mid-attempt). This finds rows whose next attempt is
 * overdue and re-arms them, which is the difference between "eventually
 * synced" and "silently never synced".
 */
crons.interval(
  "reconcile calendar syncs",
  { minutes: 5 },
  internal.calendar.sync.reconcilePending,
  {},
);

export default crons;
