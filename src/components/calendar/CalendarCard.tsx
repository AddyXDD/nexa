import { Button } from "@/components/ui/button";
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
import { api } from "@/convex/_generated/api";
import { friendlyError } from "@/lib/errors";
import { CALENDAR } from "@/shared/constants";
import {
  CalendarCheck,
  CalendarDays,
  CircleAlert,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unplug,
  UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAction, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

/**
 * Calendar connections.
 *
 * The whole surface is driven by one reactive query that reports what the
 * server actually knows — connected, needs reconnecting, or not connected —
 * so the card can never claim a connection the backend doesn't have.
 *
 * Connecting leaves the page: `startConnect` mints a single-use state token
 * server-side and hands back a consent URL, and the browser follows it. The
 * tokens come back to the Convex callback, never to this component.
 *
 * A guest session gets a sign-in prompt instead of the provider list: the
 * server refuses the flow for guests (nothing they booked could reach the
 * calendar), and showing a "Connect" button — let alone a stale "Connected"
 * pill — next to a scheduling form that turns guests away would be a lie.
 */

type ProviderStatus = {
  id: string;
  status: "connected" | "needs_reauth" | "revoked" | "not_connected";
  accountEmail: string | null;
  calendarId: string | null;
  connectedAt: number | null;
  disconnectedAt: number | null;
  scopes: string[];
  lastError: string | null;
  lastErrorAt: number | null;
};

function StatusPill({ status }: { status: ProviderStatus["status"] }) {
  const tone =
    status === "connected"
      ? "border-emerald-600/25 bg-emerald-500/10 text-emerald-700"
      : status === "needs_reauth"
        ? "border-amber-600/25 bg-amber-500/10 text-amber-700"
        : "border-border bg-muted text-muted-foreground";
  const label =
    status === "connected"
      ? "Connected"
      : status === "needs_reauth"
        ? "Reconnect needed"
        : status === "revoked"
          ? "Disconnected"
          : "Not connected";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

/**
 * The section both states share, so the guest view cannot drift from the
 * connected one: same heading, same explanation of what connecting buys you.
 */
function CalendarSection({ children }: { children: ReactNode }) {
  return (
    <section
      id="calendar"
      className="mt-4 scroll-mt-20 rounded-xl border border-border bg-card p-6 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <CalendarDays className="size-4" />
        </span>
        <h3 className="text-sm font-semibold">Calendars</h3>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Connect a calendar and every meeting you schedule here is created
        there too — with the Nexa join link in it, and Google sending the
        invitations to your guests.
      </p>
      {children}
    </section>
  );
}

export function CalendarCard() {
  const state = useQuery(api.calendar.connections.status, {});
  const startConnect = useAction(api.calendar.connections.startConnect);
  const disconnect = useAction(api.calendar.connections.disconnect);
  const navigate = useNavigate();

  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (state === undefined) return null;

  const providers = state.providers as ProviderStatus[];
  const connected = providers.some((provider) => provider.status === "connected");
  const requiresSignIn = state.requiresSignIn === true;

  const connect = async (returnTo = "/dashboard") => {
    if (busy) return;
    setBusy("connect");
    try {
      const { url } = await startConnect({ returnTo });
      // The consent screen is on Google's domain; leaving the SPA is correct
      // here and the callback brings the browser back to /dashboard.
      window.location.assign(url);
    } catch (err) {
      toast.error(friendlyError(err, CALENDAR.connectFailed));
      setBusy(null);
    }
  };

  // Per account, not per person: nothing a guest could book would ever reach
  // the calendar, so the server refuses the flow and this card asks for the
  // sign-in instead of offering a button that would be turned down.
  if (requiresSignIn) {
    return (
      <CalendarSection>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-3 py-3">
          <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {CALENDAR.guestNeedsSignIn}{" "}
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
      </CalendarSection>
    );
  }

  const doDisconnect = async () => {
    if (busy) return;
    setBusy("disconnect");
    try {
      await disconnect({});
      toast.success(CALENDAR.disconnected);
    } catch (err) {
      toast.error(friendlyError(err, CALENDAR.needsReauth));
    } finally {
      setBusy(null);
      setConfirmOpen(false);
    }
  };

  return (
    <CalendarSection>
      {!state.ready && state.reason && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-600/25 bg-amber-500/10 px-3 py-2.5">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
          <p className="text-xs leading-relaxed text-amber-800">{state.reason}</p>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {providers.map((provider) => {
          const label = CALENDAR.providerLabel[provider.id] ?? provider.id;
          const isConnected = provider.status === "connected";
          const needsReauth = provider.status === "needs_reauth";
          return (
            <li
              key={provider.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <StatusPill status={provider.status} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {isConnected ? (
                    <>
                      {provider.accountEmail
                        ? `Connected as ${provider.accountEmail}.`
                        : "Connected."}{" "}
                      Nexa writes events to{" "}
                      <span className="font-medium text-foreground">
                        {provider.calendarId === "primary"
                          ? "your primary calendar"
                          : provider.calendarId ?? "your calendar"}
                      </span>
                      .
                    </>
                  ) : needsReauth ? (
                    CALENDAR.needsReauth
                  ) : provider.status === "revoked" ? (
                    <>
                      Disconnected. {CALENDAR.disconnectKeepsEvents}
                    </>
                  ) : (
                    CALENDAR.notConnected
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isConnected ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void connect("/dashboard")}
                      disabled={busy !== null || !state.ready}
                    >
                      {busy === "connect" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Reconnect
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmOpen(true)}
                      disabled={busy !== null}
                    >
                      {busy === "disconnect" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Unplug className="size-3.5" />
                      )}
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void connect("/dashboard")}
                    disabled={busy !== null || !state.ready}
                  >
                    {busy === "connect" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CalendarCheck className="size-3.5" />
                    )}
                    {needsReauth ? "Reconnect" : "Connect"} {label}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-4 space-y-2.5 border-t border-border pt-4">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <dd className="text-[11px] leading-relaxed text-muted-foreground">
            {CALENDAR.scopeExplanation}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <dd className="text-[11px] leading-relaxed text-muted-foreground">
            Nexa stores the access it needs encrypted, uses it only to create
            and manage the events you schedule here, and asks Google to revoke
            it the moment you disconnect.
            {connected ? <> {CALENDAR.disconnectKeepsEvents}</> : null}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <dd className="text-[11px] leading-relaxed text-muted-foreground">
            {CALENDAR.guestCopies} {CALENDAR.outlookPlanned}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <dd className="text-[11px] leading-relaxed text-muted-foreground">
            See the{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Privacy Policy
            </a>{" "}
            for the exact Google scopes, what Nexa stores, and how to
            disconnect or delete it.
          </dd>
        </div>
      </dl>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect the calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              {CALENDAR.disconnectKeepsEvents} Meetings you schedule afterwards
              stay in Nexa; they just won&apos;t appear on your calendar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void doDisconnect();
              }}
              disabled={busy !== null}
            >
              {busy === "disconnect" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Disconnecting…
                </>
              ) : (
                "Disconnect"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CalendarSection>
  );
}
