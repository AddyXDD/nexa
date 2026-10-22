import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SUPPORT_EMAIL } from "@/shared/constants";
import { Loader2, ShieldAlert } from "lucide-react";
import { useId, useState } from "react";

/**
 * The acceptable-use gate in front of every meeting, hosted or joined.
 *
 * It exists because the one thing a room host cannot consent to on behalf of
 * their guests is the law: whatever happens in a meeting is the
 * participants' responsibility, not ours. Nexa provides pipes and a server;
 * we don't moderate rooms and we can't undo anything said or done in one.
 *
 * The box has to be ticked, not just the dialog closed — a click-through
 * nobody reads protects nobody. Links open in a new tab so reading the Terms
 * doesn't throw away what the user typed.
 */

/** The same rules in the same words, so nobody reads two different versions. */
const RULES = [
  "Nothing illegal — no crime, no content you have no right to share, no fraud or scams.",
  "No harassment, threats, hate, or anything that could hurt someone, in any room you host.",
  "No recording or streaming someone who hasn't agreed to it.",
  "No sneaking into rooms, accounts, or the service itself without permission.",
] as const;

export type TermsAction = "start" | "join";

const COPY = {
  start: {
    title: "Before you start a meeting",
    cta: "Start the meeting",
    pending: "Creating your room…",
    intro:
      "You're about to open a room other people will be invited to. These rules apply to you and to everyone you let in.",
  },
  join: {
    title: "Before you join",
    cta: "Join the meeting",
    pending: "Taking your seat…",
    intro:
      "One quick thing before your camera and microphone go live for everyone else in the room.",
  },
} as const;

export function MeetingTermsDialog({
  open,
  action,
  busy = false,
  onOpenChange,
  onAgree,
}: {
  open: boolean;
  /** "start" for a host opening a room, "join" for taking a seat in one. */
  action: TermsAction;
  /** True once the real start/join is in flight. */
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called only when the box is ticked. */
  onAgree: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const checkboxId = useId();
  const copy = COPY[action];

  // Dismissing clears the box, so each meeting gets a fresh prompt and no tick
  // is carried over from the room opened last time. Clearing on the way out
  // rather than on the way in keeps this off an effect. Confirming keeps it:
  // if the room fails to create the user is still looking at this dialog, and
  // re-ticking to retry would be punishment for a server-side error.
  const close = (next: boolean) => {
    if (!next) setAgreed(false);
    // No dismissing mid-flight: the action is already running.
    if (busy) return;
    onOpenChange(next);
  };

  const confirm = () => {
    if (!agreed || busy) return;
    onAgree();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      {/* `nexa-room` on the panel itself: the dialog is portalled to <body>,
          outside both `.nexa-landing` and `.nexa-room`, so it has to pin the
          same tokens or every accent in here falls back to the root green. */}
      <DialogContent
        showCloseButton={false}
        className="nexa-room max-w-md gap-0 rounded-xl border border-border bg-card/95 p-0 shadow-[0_32px_80px_-40px_rgba(23,23,26,0.65)] backdrop-blur-2xl sm:max-w-md"
      >
        <DialogHeader className="gap-3 border-b border-border p-5 pb-4 text-left">
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-[color:var(--nexa-accent)]/12 text-[color:var(--nexa-accent)] ring-1 ring-[color:var(--nexa-accent)]/25">
            <ShieldAlert className="size-4" />
          </span>
          <div className="space-y-2">
            <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
              {copy.title}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {copy.intro}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="space-y-3 p-5">
          <ul className="space-y-2">
            {RULES.map((rule) => (
              <li
                key={rule}
                className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/90"
              >
                <span
                  aria-hidden="true"
                  className="mt-[7px] size-1 shrink-0 rounded-full bg-[color:var(--nexa-accent)]"
                />
                {rule}
              </li>
            ))}
          </ul>

          <p className="rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              Nexa Meet isn&apos;t responsible for meetings.
            </span>{" "}
            We run the servers and the connection — we don&apos;t moderate
            rooms, we can&apos;t undo anything said in one, and we can&apos;t
            guarantee a meeting is legal or that anyone in it behaves. What you
            and your guests do is on you. Rooms can be suspended, and we may
            have to hand over data when the law requires it. Read{" "}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              the Terms
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              the Privacy Policy
            </a>
            , and report anything that shouldn't be here to{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>

          <label
            htmlFor={checkboxId}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] leading-relaxed text-foreground transition-colors hover:bg-muted/50"
          >
            <Checkbox
              id={checkboxId}
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              className="mt-0.5 size-4 border-border data-[state=checked]:border-[color:var(--nexa-accent)] data-[state=checked]:bg-[color:var(--nexa-accent)] data-[state=checked]:text-white"
            />
            <span>
              I understand this, I&apos;ll follow these rules, and I accept the
              Terms of Service.
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2 border-t border-border p-4 sm:justify-end">
          <button
            type="button"
            onClick={() => close(false)}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!agreed || busy}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? copy.pending : copy.cta}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}