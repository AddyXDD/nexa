import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  MEETING_DURATION_OPTIONS,
  SCHEDULING,
  normalizeMeetingMinutes,
} from "@/shared/constants";
import {
  formatDuration,
  formatInZone,
  toZonedInputValue,
  zonedInputToInstant,
} from "@/shared/time";
import { CalendarClock, Loader2 } from "lucide-react";
import { useState } from "react";

/** The booking fields this dialog is allowed to change. */
export type EditableMeeting = {
  code: string;
  title: string | null;
  startsAt: number;
  durationMinutes: number;
  timeZone: string | null;
};

/**
 * Move a booking.
 *
 * The time is edited in the booking's own zone, then converted back to an
 * instant with the shared conversion the server uses — so a meeting either side
 * of a daylight-saving change lands where the host meant it rather than an hour
 * off. The dialog is mounted per meeting (keyed by code by its caller), which
 * is why it can hold the initial values in state without syncing them in an
 * effect.
 */
export function RescheduleDialog({
  meeting,
  onClose,
  onSubmit,
}: {
  meeting: EditableMeeting;
  onClose: () => void;
  onSubmit: (values: {
    code: string;
    title: string;
    startsAt: number;
    durationMinutes: number;
    timeZone: string;
  }) => Promise<void>;
}) {
  const zone = meeting.timeZone ?? "UTC";
  const [title, setTitle] = useState(meeting.title ?? "");
  const [when, setWhen] = useState(() => toZonedInputValue(meeting.startsAt, zone));
  const [durationMinutes, setDurationMinutes] = useState(meeting.durationMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startsAt = zonedInputToInstant(when, zone);
  const preview =
    startsAt === null
      ? null
      : `${formatInZone(startsAt, zone, {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        })} · ${formatDuration(durationMinutes)} · ${zone}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (startsAt === null) {
      setError(SCHEDULING.pastDate);
      return;
    }
    const duration = normalizeMeetingMinutes(durationMinutes);
    if (duration === null) {
      setError(SCHEDULING.badDuration);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        code: meeting.code,
        title: title.trim(),
        startsAt,
        durationMinutes: duration,
        timeZone: zone,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change this meeting</DialogTitle>
          <DialogDescription>
            Timezone: <span className="font-medium text-foreground">{zone}</span>.
            {meeting.timeZone
              ? " This is the zone the meeting was booked in, so the time you see is the time your guests were told."
              : " The booking has no zone recorded, so times are shown in UTC."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label
              htmlFor="reschedule-title"
              className="text-xs font-medium text-muted-foreground"
            >
              What it&apos;s about{" "}
              <span className="font-normal">(optional)</span>
            </label>
            <Input
              id="reschedule-title"
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
                htmlFor="reschedule-when"
                className="text-xs font-medium text-muted-foreground"
              >
                New time
              </label>
              <Input
                id="reschedule-when"
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <label
                htmlFor="reschedule-duration"
                className="text-xs font-medium text-muted-foreground"
              >
                Length
              </label>
              <select
                id="reschedule-duration"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
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

          {preview && (
            <p className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <CalendarClock className="size-3.5 shrink-0" />
              {preview}
            </p>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
