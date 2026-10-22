import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  RescheduleDialog,
  type EditableMeeting,
} from "@/components/calendar/RescheduleDialog";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { friendlyError } from "@/lib/errors";
import {
  CALENDAR,
  DEFAULT_MEETING_MINUTES,
  MAX_INVITEES_PER_MEETING,
  MEETING_DURATION_OPTIONS,
  SCHEDULING,
  formatMeetingCode,
  normalizeMeetingMinutes,
  parseInviteEmails,
} from "@/shared/constants";
import {
  addMinutes,
  formatDuration,
  formatInZone,
  listTimeZones,
  zonedInputToInstant,
} from "@/shared/time";
import {
  CalendarClock,
  CalendarPlus,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  Pencil,
  RotateCw,
  Trash2,
  TriangleAlert,
  Video,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

/**
 * Schedule a meeting.
 *
 * One booking does two things that can fail independently, and the UI treats
 * them that way: the meeting record (a room code and a join link, which is
 * Nexa's own responsibility) and the calendar event (which depends on Google).
 * Booking a meeting never fails because a calendar is unhappy — the row is
 * created, the calendar is reported honestly, and a failed sync can be retried
 * from the list without duplicating anything.
 *
 * The room itself is created the first time somebody opens the link, so nothing
 * sits idle between booking and meeting.
 */

type LinkedRow = {
  meetingCode: string;
  provider: string;
  syncStatus: "pending" | "synced" | "failed" | "cancelled";
  htmlLink: string | null;
  lastError: string | null;
  attempts: number;
  needsReauth: boolean;
  lastSyncedAt: number | null;
  nextAttemptAt: number | null;
  cancelled: boolean;
};

const TIME_ZONES = listTimeZones();

export function ScheduleCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isGuest = user?.isAnonymous === true || !user?.email;

  const scheduleMeeting = useMutation(api.schedule.schedule);
  const rescheduleMeeting = useMutation(api.schedule.reschedule);
  const sendInvites = useAction(api.schedule.sendInvites);
  const cancelMeeting = useMutation(api.schedule.cancel);
  const syncMeeting = useAction(api.calendar.sync.syncMeeting);
  const cancelCalendar = useAction(api.calendar.sync.cancelForBooking);
  const booked = useQuery(api.schedule.list);
  const links = useQuery(api.calendar.connections.listLinks);
  const calendar = useQuery(api.calendar.connections.status);

  const detectedZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [timeZone, setTimeZone] = useState(detectedZone);
  const [durationMinutes, setDurationMinutes] = useState<number>(
    DEFAULT_MEETING_MINUTES,
  );
  const [invitees, setInvitees] = useState("");
  const [addToCalendar, setAddToCalendar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [syncingCode, setSyncingCode] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditableMeeting | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const provider = calendar?.providers.find((entry) => entry.id === "google");
  const calendarConnected = provider?.status === "connected";
  const calendarReady = calendar?.ready === true;

  /** Live count so the host sees who will be emailed before committing. */
  const parsed = useMemo(() => parseInviteEmails([invitees]), [invitees]);
  // Soonest first. Not time-filtered: a booking that has already passed is
  // still worth showing, and "expired" is relative to the user's clock.
  const upcoming = (booked ?? [])
    .filter((row) => row.status === "scheduled")
    .sort((a, b) => a.startsAt - b.startsAt);

  const linkFor = (code: string) =>
    `${window.location.origin}/m/${formatMeetingCode(code)}`;

  const linkOf = (code: string): LinkedRow | null =>
    (links as LinkedRow[] | undefined)?.find((entry) => entry.meetingCode === code) ??
    null;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      setCopied(code);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  const reportSync = (outcome: {
    status: string;
    message?: string;
  }, verb: "created" | "updated") => {
    switch (outcome.status) {
      case "synced":
        toast.success(
          verb === "created"
            ? "Added to your calendar."
            : "Calendar event updated.",
        );
        break;
      case "pending":
        toast.info(CALENDAR.retrying);
        break;
      case "needs_reauth":
        toast.error(CALENDAR.needsReauth);
        break;
      case "failed":
        toast.error(outcome.message ?? CALENDAR.failed);
        break;
      case "not_connected":
        toast.info(CALENDAR.notConnected);
        break;
      default:
        break;
    }
  };

  const syncOne = async (code: string, force = false) => {
    if (syncingCode) return;
    setSyncingCode(code);
    try {
      const outcome = await syncMeeting({ code, force });
      reportSync(outcome, force ? "updated" : "created");
    } catch (err) {
      toast.error(friendlyError(err, CALENDAR.failed));
    } finally {
      setSyncingCode(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || isGuest) return;

    const startsAt = zonedInputToInstant(when, timeZone);
    if (startsAt === null || startsAt < Date.now() - 60_000) {
      toast.error(SCHEDULING.pastDate);
      return;
    }
    const duration = normalizeMeetingMinutes(durationMinutes);
    if (duration === null) {
      toast.error(SCHEDULING.badDuration);
      return;
    }

    setBusy(true);
    try {
      const { code } = await scheduleMeeting({
        title: title.trim() || undefined,
        startsAt,
        timeZone,
        invitees: [invitees],
        durationMinutes: duration,
      });

      // Emailed invitations. A failure here does not lose the booking: the
      // host still has the link to share by hand.
      let emailed: number | null = null;
      if (parsed.emails.length > 0) {
        try {
          const result = await sendInvites({ code });
          emailed = result.sent;
          if (result.failed > 0) {
            toast.error(
              `Scheduled, but ${result.failed} invite${result.failed === 1 ? "" : "s"} couldn't be sent.`,
            );
          }
        } catch (err) {
          toast.error(friendlyError(err, SCHEDULING.emailNotConfigured));
        }
      }

      // The calendar event, explicitly after the booking exists.
      let calendarLine = "";
      if (addToCalendar && calendarConnected) {
        const outcome = await syncMeeting({ code });
        calendarLine =
          outcome.status === "synced"
            ? " Added to your calendar."
            : outcome.status === "pending"
              ? " Google Calendar is slow right now — Nexa will keep retrying."
              : outcome.status === "needs_reauth"
                ? " Reconnect Google Calendar to add it."
                : outcome.status === "failed"
                  ? " The calendar event couldn't be created — retry it below."
                  : "";
      }

      const guestLine =
        emailed === null
          ? " No guests, so it's a private meeting on your calendar."
          : emailed === 0
            ? ""
            : ` Invited ${emailed} ${emailed === 1 ? "person" : "people"}.`;
      toast.success(`Meeting scheduled.${guestLine}${calendarLine}`);

      setTitle("");
      setWhen("");
      setInvitees("");
    } catch (err) {
      toast.error(friendlyError(err, SCHEDULING.sendFailed));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (code: string) => {
    setCancelling(null);
    try {
      // Nexa's booking first, then the calendar event: the booking is the
      // source of truth, and a failed calendar delete is retryable.
      await cancelMeeting({ code });
      const linked = linkOf(code);
      if (linked) {
        try {
          const outcome = await cancelCalendar({ code });
          if (outcome.status !== "cancelled" && outcome.status !== "not_connected") {
            toast.info(
              "Meeting cancelled. The calendar event couldn't be removed — retry it below.",
            );
            return;
          }
        } catch (err) {
          toast.error(friendlyError(err, SCHEDULING.notFound));
          return;
        }
      }
      toast.success("Meeting cancelled.");
    } catch (err) {
      toast.error(friendlyError(err, SCHEDULING.notFound));
    }
  };

  const saveReschedule = async (values: {
    code: string;
    title: string;
    startsAt: number;
    durationMinutes: number;
    timeZone: string;
  }) => {
    await rescheduleMeeting({
      code: values.code,
      title: values.title,
      startsAt: values.startsAt,
      durationMinutes: values.durationMinutes,
      timeZone: values.timeZone,
    });
    setEditing(null);
    // Re-apply the desired state to the same calendar event: the sync patches
    // the linked event rather than creating a second one.
    if (linkOf(values.code)) {
      await syncOne(values.code, true);
    } else {
      toast.success("Meeting updated.");
    }
  };

  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-5">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm lg:col-span-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
          <CalendarClock className="size-4" />
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">
          Schedule a meeting
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Pick a time, add the people you want there, and Nexa emails each of
          them the join link. The room itself is created when they open it —
          nothing sits idle in between.
        </p>

        {isGuest ? (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-3 py-3">
            <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {SCHEDULING.guestsBlocked}{" "}
              <button
                type="button"
                onClick={() =>
                  navigate(`/auth?returnTo=${encodeURIComponent("/dashboard")}`)
                }
                className="font-medium text-foreground underline underline-offset-2"
              >
                Sign in
              </button>
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <label
                htmlFor="schedule-title"
                className="text-xs font-medium text-muted-foreground"
              >
                What&apos;s it about{" "}
                <span className="font-normal">(optional)</span>
              </label>
              <Input
                id="schedule-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder="Design review"
                className="mt-1.5"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="schedule-when"
                  className="text-xs font-medium text-muted-foreground"
                >
                  When
                </label>
                <Input
                  id="schedule-when"
                  type="datetime-local"
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                  required
                  className="mt-1.5"
                />
              </div>
              <div>
                <label
                  htmlFor="schedule-duration"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Length
                </label>
                <select
                  id="schedule-duration"
                  value={durationMinutes}
                  onChange={(event) =>
                    setDurationMinutes(Number(event.target.value))
                  }
                  className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-[color:var(--nexa-accent)]/60 focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
                >
                  {MEETING_DURATION_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatDuration(minutes)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="schedule-timezone"
                className="text-xs font-medium text-muted-foreground"
              >
                Timezone
              </label>
              <select
                id="schedule-timezone"
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
                className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-[color:var(--nexa-accent)]/60 focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
              >
                {TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {when && zonedInputToInstant(when, timeZone) !== null
                  ? `${formatInZone(zonedInputToInstant(when, timeZone)!, timeZone, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })} – ${formatInZone(
                      addMinutes(zonedInputToInstant(when, timeZone)!, durationMinutes),
                      timeZone,
                      { hour: "numeric", minute: "2-digit" },
                    )} (${timeZone})`
                  : "Times are recorded with this zone, so guests see the hour you meant even across daylight-saving changes."}
              </p>
            </div>

            <div>
              <label
                htmlFor="schedule-invitees"
                className="text-xs font-medium text-muted-foreground"
              >
                Invite by email{" "}
                <span className="font-normal">(optional)</span>
              </label>
              <textarea
                id="schedule-invitees"
                value={invitees}
                onChange={(event) => setInvitees(event.target.value)}
                rows={2}
                placeholder="priya@example.com, sam@example.com"
                className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-[color:var(--nexa-accent)]/60 focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {parsed.invalid.length > 0
                  ? `${SCHEDULING.badAddress} (${parsed.invalid[0]})`
                  : parsed.emails.length === 0
                    ? `Up to ${MAX_INVITEES_PER_MEETING} people. Separate with commas — leave it empty for a private meeting.`
                    : `${parsed.emails.length} ${
                        parsed.emails.length === 1 ? "person" : "people"
                      } will get the join link by email${calendarConnected ? ", and Google Calendar will send its own invitation" : ""}.`}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/40 px-3 py-3">
              {calendarConnected ? (
                <label
                  htmlFor="schedule-calendar"
                  className="flex cursor-pointer items-start gap-2.5"
                >
                  <Checkbox
                    id="schedule-calendar"
                    checked={addToCalendar}
                    onCheckedChange={(checked) =>
                      setAddToCalendar(checked === true)
                    }
                    className="mt-0.5 size-4 border-border data-[state=checked]:border-[color:var(--nexa-accent)] data-[state=checked]:bg-[color:var(--nexa-accent)] data-[state=checked]:text-white"
                  />
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Add to {provider?.accountEmail ?? "Google Calendar"}
                    </span>{" "}
                    — the event carries the join link and, if you added guests,
                    Google sends the invitation. You can reschedule or cancel it
                    from here afterwards.
                  </span>
                </label>
              ) : (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <CalendarPlus className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {calendarReady
                      ? CALENDAR.notConnected
                      : "Calendar sync isn't configured on this deployment."}{" "}
                    {calendarReady ? (
                      <a
                        href="#calendar"
                        className="font-medium text-foreground underline underline-offset-2"
                      >
                        Connect a calendar
                      </a>
                    ) : null}
                  </span>
                </p>
              )}
            </div>

            <Button type="submit" disabled={busy || !when} className="h-11 w-full sm:w-auto">
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Scheduling…
                </>
              ) : (
                <>
                  <Mail className="size-4" /> Schedule
                  {parsed.emails.length > 0 ? " & send invites" : ""}
                </>
              )}
            </Button>
          </form>
        )}
      </div>

      {/* Upcoming bookings */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm lg:col-span-2">
        <h3 className="text-sm font-semibold tracking-tight">
          Upcoming meetings
        </h3>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Nothing scheduled. Anything you book shows up here with its link.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {upcoming.map((row) => {
              const linked = linkOf(row.code);
              const syncing = syncingCode === row.code;
              return (
                <li
                  key={row.code}
                  className="rounded-lg border border-border bg-muted/40 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {row.title ?? "Nexa Meet"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatInZone(row.startsAt, row.timeZone, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}{" "}
                        · {formatDuration(row.durationMinutes)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <span className="font-mono">
                          {formatMeetingCode(row.code)}
                        </span>
                        {" · "}
                        {row.inviteeCount === 0
                          ? "No guests"
                          : `Invited ${row.inviteeCount}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {linked?.htmlLink && (
                        <a
                          href={linked.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          title="Open in Google Calendar"
                          aria-label="Open in Google Calendar"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(`/m/${formatMeetingCode(row.code)}`)}
                        title="Open the room — the same link your guests use, and it works before the meeting starts"
                        aria-label="Join the meeting room"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        <Video className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        title="Change this meeting"
                        aria-label="Change this meeting"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void copy(row.code)}
                        title="Copy meeting link"
                        aria-label="Copy meeting link"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        {copied === row.code ? (
                          <Check className="size-4" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCancelling(row.code)}
                        title="Cancel meeting"
                        aria-label="Cancel meeting"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>

                  {/* Calendar sync state: what the server actually knows. */}
                  {calendarConnected ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                      {linked === null ? (
                        <>
                          <span className="text-[11px] text-muted-foreground">
                            {CALENDAR.notSynced}
                          </span>
                          <button
                            type="button"
                            onClick={() => void syncOne(row.code)}
                            disabled={syncing}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60"
                          >
                            {syncing ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <CalendarPlus className="size-3" />
                            )}
                            Add to calendar
                          </button>
                        </>
                      ) : linked.syncStatus === "synced" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <CalendarClock className="size-3" />
                          {CALENDAR.synced}
                        </span>
                      ) : linked.syncStatus === "cancelled" ? (
                        <span className="text-[11px] text-muted-foreground">
                          {CALENDAR.cancelled}
                        </span>
                      ) : linked.syncStatus === "pending" ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            {syncing ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <RotateCw className="size-3" />
                            )}
                            Syncing…
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Nexa retries on its own.
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-600/25 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700">
                            <TriangleAlert className="size-3" />
                            {linked.needsReauth ? "Reconnect needed" : "Not synced"}
                          </span>
                          {linked.needsReauth ? (
                            <a
                              href="#calendar"
                              className="text-[11px] font-medium text-foreground underline underline-offset-2"
                            >
                              Reconnect
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void syncOne(row.code, true)}
                              disabled={syncing}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60"
                            >
                              {syncing ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <RotateCw className="size-3" />
                              )}
                              Retry
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <Trash2 className="mt-0.5 size-3.5 shrink-0" />
          Cancelling stops the invite link from opening a new room
          {calendarConnected ? " and removes the calendar event" : ""}. Addresses
          are stored only so you can resend or cancel, and are never shown in a
          meeting.
        </p>
      </div>

      {editing && (
        <RescheduleDialog
          key={editing.code}
          meeting={editing}
          onClose={() => setEditing(null)}
          onSubmit={saveReschedule}
        />
      )}

      <AlertDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              The invite link stops working and{" "}
              {calendarConnected
                ? "the calendar event is removed, so Google tells your guests it was cancelled."
                : "nothing else happens — the meeting was never added to a calendar."}{" "}
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (cancelling) void cancel(cancelling);
              }}
            >
              Cancel meeting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
