import { BillingCard } from "@/components/BillingCard";
import { OrganizationsCard } from "@/components/org/OrganizationsCard";
import { OrgSwitcher } from "@/components/org/OrgSwitcher";
import { ScheduleCard } from "@/components/ScheduleCard";
import { CalendarCard } from "@/components/calendar/CalendarCard";
import { MeetingTermsDialog } from "@/components/MeetingTermsDialog";
import { NexaLogo } from "@/components/NexaMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useDesktopBridge, useExternalLinks } from "@/hooks/use-desktop";
import { useGuestSession } from "@/hooks/use-guest-session";
import { friendlyError } from "@/lib/errors";
import {
  CALENDAR,
  MEETING_CODE_REGEX,
  formatMeetingCode,
  parseMeetingCodeInput,
} from "@/shared/constants";
import {
  ArrowRight,
  Check,
  Copy,
  Fingerprint,
  Loader2,
  LogOut,
  Plus,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { toast } from "sonner";

/**
 * The signed-in workspace: start or join a meeting, manage the Nexa
 * identity other participants see, and handle billing. There is no meeting
 * history here — by design, Nexa Meet doesn't keep one.
 */
export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { ensureSession } = useGuestSession();
  const navigate = useNavigate();
  const ensureIdentity = useMutation(api.identity.ensure);
  const setDisplayName = useMutation(api.identity.setDisplayName);
  const createMeeting = useMutation(api.meetings.create);

  const [starting, setStarting] = useState(false);
  // Opening a room is gated on the acceptable-use prompt; the invite code
  // path isn't, because every joiner clears the same gate in pre-join.
  const [termsOpen, setTermsOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  const joinCodeRef = useRef<HTMLInputElement>(null);

  // Desktop shell: `nexameet://` links land here. In a browser this hook
  // is inert — nothing subscribes, nothing changes.
  useExternalLinks();
  useDesktopBridge({
    onStart: () => setTermsOpen(true),
    onJoin: (code) => {
      setJoinCode(code);
      setJoinError(null);
      navigate(`/m/${formatMeetingCode(code)}`);
    },
    onPromptJoin: () => joinCodeRef.current?.focus(),
  });
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Mint the Nexa ID on first visit (idempotent; the query updates live).
  useEffect(() => {
    void ensureIdentity({}).catch(() => {});
  }, [ensureIdentity]);

  useEffect(() => {
    if (user?.name) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Convex query snapshot
      setNameDraft(user.name);
    }
  }, [user?.name]);

  // The calendar callback lands here with `?calendar=connected` (or an error
  // reason) and says what actually happened. The parameters are stripped from
  // the URL so a refresh doesn't replay the message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    if (result === "connected") {
      toast.success(CALENDAR.connected);
    } else {
      const reason = params.get("reason");
      toast.error(
        reason === "denied"
          ? CALENDAR.denied
          : reason === "state"
            ? CALENDAR.stateExpired
            : CALENDAR.callbackFailed,
      );
    }
    params.delete("calendar");
    params.delete("reason");
    params.delete("provider");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, []);

  const isGuest = user?.isAnonymous === true;
  const nexaId = user?.nexaId;

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    try {
      // Normally a no-op here, but the session can lapse (expired token,
      // sign-out in another tab) — never fail on "Not authenticated."
      await ensureSession();
      await ensureIdentity({});
      const { code } = await createMeeting({});
      navigate(`/m/${formatMeetingCode(code)}`);
    } catch (err) {
      toast.error(friendlyError(err, "A meeting couldn't be created right now."));
      setStarting(false);
    }
  };

  const handleJoin = (event: React.FormEvent) => {
    event.preventDefault();
    const code = parseMeetingCodeInput(joinCode);
    if (!MEETING_CODE_REGEX.test(code)) {
      setJoinError(
        "That doesn't look like a meeting code. Codes are 16 characters, like 7K2M-9QX4-TRBD-1HYN.",
      );
      return;
    }
    setJoinError(null);
    navigate(`/m/${formatMeetingCode(code)}`);
  };

  const handleSaveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingName) return;
    setSavingName(true);
    try {
      await setDisplayName({ name: nameDraft });
      toast.success("Display name updated.");
    } catch (err) {
      toast.error(friendlyError(err, "The name couldn't be saved."));
    } finally {
      setSavingName(false);
    }
  };

  const copyNexaId = async () => {
    if (!nexaId) return;
    try {
      await navigator.clipboard.writeText(nexaId);
      toast.success("Nexa ID copied.");
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-foreground"
          >
            <NexaLogo markClassName="size-6" />
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <OrgSwitcher />
            {nexaId && (
              <span className="hidden rounded-lg border border-border bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground sm:inline">
                {nexaId}
              </span>
            )}
            <Link
              to="/privacy"
              className="hidden rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline"
            >
              Privacy
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {user?.name ? `Welcome back, ${user.name}.` : "Start a room, share the link."}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Rooms are temporary: when the last person leaves, the meeting&apos;s
            data (roster, chat, connection state) is destroyed. Your account
            details stay separate from everything said in a room.
          </p>
        </div>

        {/* Start / join */}
        <section className="mt-8 grid gap-4 lg:grid-cols-5">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm lg:col-span-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
              <Plus className="size-4" />
            </span>
            <h2 className="mt-4 text-lg font-semibold tracking-tight">
              Start a meeting
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Creates a room with an unguessable 16-character code and puts you
              straight into it. Share the link; guests join without an account.
            </p>
            <button
              type="button"
              onClick={() => setTermsOpen(true)}
              disabled={starting}
              className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {starting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Creating room…
                </>
              ) : (
                <>
                  Start a meeting <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </div>

          <form
            onSubmit={handleJoin}
            className="rounded-xl border border-border bg-card p-6 shadow-sm lg:col-span-2"
          >
            <span className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground">
              <ArrowRight className="size-4" />
            </span>
            <h2 className="mt-4 text-lg font-semibold tracking-tight">
              Join a meeting
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Paste an invite link or type the code from the host.
            </p>
            <div className="mt-4 flex gap-2">
              <Input
                ref={joinCodeRef}
                value={joinCode}
                onChange={(event) => {
                  setJoinCode(event.target.value);
                  setJoinError(null);
                }}
                placeholder="Meeting code or link"
                aria-label="Meeting code or link"
                className="font-mono"
              />
              <Button type="submit" className="shrink-0">
                Join
              </Button>
            </div>
            {joinError && (
              <p className="mt-2 text-xs text-red-500">{joinError}</p>
            )}
          </form>
        </section>

        {/* Schedule */}
        <ScheduleCard />

        {/* Organizations (paid workspaces) */}
        <OrganizationsCard />

        {/* Calendar connection */}
        <CalendarCard />

        {/* Identity + billing */}
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Fingerprint className="size-4" />
              </span>
              <h3 className="text-sm font-semibold">Your Nexa ID</h3>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3">
              <span className="font-mono text-xl tracking-[0.16em]">
                {nexaId ?? "············"}
              </span>
              {nexaId && (
                <button
                  type="button"
                  onClick={() => void copyNexaId()}
                  title="Copy Nexa ID"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <Copy className="size-4" />
                </button>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              This is the only identity other participants see in a room,
              never your email address.
            </p>

            <form onSubmit={handleSaveName} className="mt-4">
              <label className="text-xs font-medium text-muted-foreground">
                Display name{" "}
                <span className="font-normal">(optional, shown next to your ID)</span>
              </label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  maxLength={32}
                  placeholder="e.g. Priya"
                  aria-label="Display name"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="shrink-0"
                  disabled={savingName}
                >
                  {savingName ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Save
                </Button>
              </div>
            </form>

            {isGuest && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2.5">
                <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  You&apos;re using a guest identity, perfectly fine for
                  meetings.{" "}
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/auth?returnTo=${encodeURIComponent("/dashboard")}`)
                    }
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Sign in with email
                  </button>{" "}
                  to manage billing and your profile from any device.
                </p>
              </div>
            )}
          </div>

          <BillingCard contactEmail={user?.email ?? null} />
        </section>

        {/* Privacy summary */}
        <section className="mt-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ShieldCheck className="size-4" />
            </span>
            <h3 className="text-sm font-semibold">What Nexa Meet keeps</h3>
          </div>
          <ul className="mt-3 grid gap-2 text-sm leading-relaxed text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <li>
              <strong className="font-medium text-foreground">Account:</strong>{" "}
              your email (for sign-in), display name, and Nexa ID.
            </li>
            <li>
              <strong className="font-medium text-foreground">Billing:</strong>{" "}
              payment records, because financial law requires them.
            </li>
            <li>
              <strong className="font-medium text-foreground">Bookings:</strong>{" "}
              a meeting you scheduled, and the addresses you sent it to.
            </li>
            <li>
              <strong className="font-medium text-foreground">Meetings:</strong>{" "}
              nothing. When a room closes, its roster, chat, and connection
              state are destroyed.
            </li>
          </ul>
          <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            The full policy — including exactly what Nexa receives from Google
            when you sign in or connect a calendar, and how to disconnect or
            delete it — is in the{" "}
            <Link
              to="/privacy"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </main>

      <MeetingTermsDialog
        open={termsOpen}
        action="start"
        busy={starting}
        onOpenChange={setTermsOpen}
        onAgree={() => void handleStart()}
      />
    </div>
  );
}
