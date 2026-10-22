import { NexaMark } from "@/components/NexaMark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAdminSession, useAdminToken } from "@/hooks/use-admin-session";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import {
  Activity,
  ArrowUpRight,
  CreditCard,
  Loader2,
  LogOut,
  Search,
  ShieldCheck,
  Users as UsersIcon,
  Video,
  X,
} from "lucide-react";
import { Component, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";

/**
 * /admin — the control deck.
 *
 * Reached only by typing the path: nothing in the product links here, and a
 * signed-in non-admin is handed the same 404 as a URL that does not exist,
 * so the route never confirms its own existence. The route is deliberately
 * *not* wrapped in RequireAuth (see `src/main.tsx`): a visitor with no admin
 * token is sent to the standalone /admin/login, never asked to sign in to
 * the product.
 *
 * Read-only by construction: the backend exposes no mutation that can change
 * a role, an account, or a payment. This page observes.
 */

type Tab = "overview" | "users" | "payments";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const DAY_MS = 86_400_000;

function ago(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "never";
  const delta = Date.now() - ms;
  if (delta < 45_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < DAY_MS) return `${Math.round(delta / 3_600_000)}h ago`;
  if (delta < 30 * DAY_MS) return `${Math.round(delta / DAY_MS)}d ago`;
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** A calendar date, for "counting since" rather than "how long ago". */
function onDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string | null, nexaId: string | null): string {
  const source = (name ?? nexaId ?? "?").replace(/[^A-Za-z0-9]+/g, " ").trim();
  return (
    source
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const { token, store } = useAdminToken();
  const session = useAdminSession(token);
  const logout = useMutation(api.adminAuth.logout);

  // A live session means a stored token *and* the server having confirmed it.
  // `session` is `undefined` while that check is in flight (and stays
  // `undefined` forever when there is no token at all, because the session
  // query is skipped), so testing it against `null` alone would let the
  // overview — which carries real user data — fire with no usable token and
  // be refused with "Not found.", crashing the deck instead of bouncing to
  // /admin/login.
  const hasLiveSession =
    token !== null && session !== undefined && session !== null;
  const overview = useQuery(
    api.admin.overview,
    hasLiveSession && token !== null ? { token } : "skip",
  );

  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  // Typed as the id the backend actually takes, so the sheet's query is
  // checked rather than cast through `never`.
  const [selected, setSelected] = useState<GenericId<"users"> | null>(null);

  // Nothing stored: straight to the standalone sign-in, never a spinner that
  // can never resolve (the session query is skipped without a token).
  if (token === null) return <Navigate to="/admin/login" replace />;

  // Still checking the stored token.
  if (session === undefined) {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  // A wrong token or an expired session: the same destination as any dead
  // URL. Nothing here confirms /admin exists.
  if (session === null) return <Navigate to="/admin/login" replace />;

  // A session that lapses while the deck is open (12h) would otherwise make
  // the next admin read throw mid-render; drop the dead token and send the
  // browser back to the sign-in instead.
  const onAuthLost = () => store(null);

  const signOut = async () => {
    const current = token;
    store(null);
    if (current !== null) {
      try {
        await logout({ token: current });
      } catch {
        /* the token is gone locally either way */
      }
    }
    navigate("/admin/login", { replace: true });
  };

  return (
    <AdminAuthBoundary onAuthLost={onAuthLost}>
      <Shell onSignOut={() => void signOut()}>
        <Overview overview={overview} />

        <nav className="mt-8 flex items-center gap-1 border-b border-border">
          {(
            [
              ["overview", "Overview", Activity],
              ["users", "Users", UsersIcon],
              ["payments", "Payments", CreditCard],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-[color:var(--nexa-accent)] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-6 pb-16">
          {tab === "overview" && <LiveNow overview={overview} />}
          {tab === "users" && (
            <UsersTab
              token={token}
              search={search}
              setSearch={setSearch}
              onSelect={setSelected}
            />
          )}
          {tab === "payments" && <PaymentsTab token={token} />}
        </div>

        {selected !== null && (
          <UserSheet
            token={token}
            userId={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </Shell>
    </AdminAuthBoundary>
  );
}

/**
 * Any refused admin read (an expired session, a token revoked elsewhere) lands
 * here instead of taking the whole route down: the dead token is dropped and
 * the browser follows the same path as a signed-out visitor.
 */
class AdminAuthBoundary extends Component<
  { onAuthLost: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onAuthLost();
  }

  render() {
    if (this.state.failed) return <Navigate to="/admin/login" replace />;
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

function Shell({
  children,
  onSignOut,
}: {
  children: React.ReactNode;
  onSignOut?: () => void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-card/40">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-6">
          <span className="inline-flex items-center gap-2.5">
            <NexaMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight">Nexa</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[color:var(--nexa-accent)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--nexa-accent)] ring-1 ring-[color:var(--nexa-accent)]/25">
              <ShieldCheck className="size-3" />
              Control
            </span>
          </span>
          {onSignOut && (
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          )}
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-5 pt-8 sm:px-6">{children}</main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Stat tiles
 * ------------------------------------------------------------------ */

type Overview = NonNullable<
  ReturnType<typeof useQuery<typeof api.admin.overview>>
>;

function Overview({
  overview,
}: {
  overview: Overview | undefined;
}) {
  if (overview === undefined) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
    );
  }

  const { users, meetings, payments } = overview;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Stat
        label="Live now"
        value={users.live}
        hint={`${users.liveRooms} room${users.liveRooms === 1 ? "" : "s"} open`}
        icon={<Activity className="size-4" />}
        accent={users.live > 0}
      />
      <Stat
        label="Accounts"
        value={users.total}
        hint={`${users.accounts} signed in · ${users.guests} guests`}
        icon={<UsersIcon className="size-4" />}
      />
      <Stat
        label="Revenue"
        value={inr.format(payments.revenuePaise / 100)}
        hint={`${payments.paid} settled of ${payments.total}`}
        icon={<CreditCard className="size-4" />}
      />
      <Stat
        label="Subscribers"
        value={payments.subscribers}
        hint={`${meetings.active} rooms live now`}
        icon={<ArrowUpRight className="size-4" />}
      />
      <Stat
        label="Meetings held"
        value={meetings.lifetime}
        hint={
          meetings.since === null
            ? "none yet"
            : `since ${onDate(meetings.since)}`
        }
        icon={<Video className="size-4" />}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
  accent = false,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-4 shadow-sm ${
        accent ? "border-[color:var(--nexa-accent)]/35" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p
        className={`mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums ${
          accent ? "text-[color:var(--nexa-accent)]" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overview tab
 * ------------------------------------------------------------------ */

function LiveNow({ overview }: { overview: Overview | undefined }) {
  if (overview === undefined) {
    return <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />;
  }
  const live = overview.liveNow;

  return (
    <Panel
      title="In a room right now"
      hint="Distinct accounts with a heartbeat inside the last two minutes."
    >
      {live.length === 0 ? (
        <Empty>Nobody is in a meeting.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {live.map((row) => (
            <li
              key={`${row.userId}-${row.meetingCode}`}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-semibold">
                  {initials(row.displayName, row.nexaId)}
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[color:var(--nexa-accent)] ring-2 ring-card" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {row.displayName ?? row.nexaId ?? "Unknown"}
                  </span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {row.nexaId ?? "—"}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {row.meetingCode.slice(0, 4)}…
                </span>
                <span className="block text-[11px] text-muted-foreground/70">
                  {ago(row.lastSeenAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {live.length >= 12 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Showing the 12 most recent. The full roster is per-room state and is
          deleted when the room closes.
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Users tab
 * ------------------------------------------------------------------ */

function UsersTab({
  token,
  search,
  setSearch,
  onSelect,
}: {
  token: string | null;
  search: string;
  setSearch: (value: string) => void;
  onSelect: (id: GenericId<"users">) => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.admin.users,
    { token: token ?? undefined },
    { initialNumItems: 25 },
  );

  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => {
    if (needle.length === 0) return results;
    return results.filter((row) =>
      [row.name, row.email, row.nexaId].some((field) =>
        field?.toLowerCase().includes(needle),
      ),
    );
  }, [results, needle]);

  const totalLoaded = results.length;
  const loadingMore = status === "LoadingMore";

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email or Nexa ID"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {needle.length > 0
            ? `${rows.length} of ${totalLoaded} loaded match`
            : `${totalLoaded} loaded`}
        </p>
      </div>

      <Panel flush>
        {rows.length === 0 ? (
          <Empty>
            {status === "LoadingFirstPage"
              ? "Loading accounts…"
              : needle.length > 0
                ? "No loaded account matches that."
                : "No accounts yet."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 font-medium">Payments</th>
                  <th className="px-4 py-2.5 font-medium">Last seen</th>
                  <th className="px-4 py-2.5 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onSelect(row.id)}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-semibold">
                          {initials(row.name, row.nexaId)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {row.name ?? "Unnamed"}
                            {row.role === "admin" && (
                              <ShieldCheck className="ml-1.5 inline size-3 text-[color:var(--nexa-accent)]" />
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.email ?? (row.isAnonymous ? "guest" : "—")}
                            {row.nexaId && (
                              <span className="ml-2 font-mono">{row.nexaId}</span>
                            )}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <PlanBadge plan={row.plan} />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {row.paymentCount}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {ago(row.lastSeenAt)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {ago(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {status === "CanLoadMore" && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => loadMore(25)} disabled={loadingMore}>
            {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  if (plan === "business") {
    return (
      <Badge className="bg-[color:var(--nexa-accent)]/12 text-[color:var(--nexa-accent)] ring-1 ring-[color:var(--nexa-accent)]/25 hover:bg-[color:var(--nexa-accent)]/12">
        Business
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="font-normal text-muted-foreground"
    >
      Free
    </Badge>
  );
}

/* ------------------------------------------------------------------ *
 * Payments tab
 * ------------------------------------------------------------------ */

function PaymentsTab({ token }: { token: string | null }) {
  const { results: rows, status, loadMore } = usePaginatedQuery(
    api.admin.payments,
    { token: token ?? undefined },
    { initialNumItems: 25 },
  );
  const loadingMore = status === "LoadingMore";

  return (
    <>
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>
            {status === "LoadingFirstPage" ? "Loading payments…" : "No payments recorded yet."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-muted/50">
                    <td className="px-4 py-2.5">
                      <span className="block truncate font-medium">
                        {row.user.name ?? row.user.email ?? "Unnamed"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.user.email ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {row.orderId}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {inr.format(row.amount / 100)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {ago(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {status === "CanLoadMore" && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => loadMore(25)} disabled={loadingMore}>
            {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return <Badge className="bg-emerald-500/12 text-emerald-600 ring-1 ring-emerald-500/25 hover:bg-emerald-500/12">Paid</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      Initiated
    </Badge>
  );
}

/* ------------------------------------------------------------------ *
 * User sheet
 * ------------------------------------------------------------------ */

function UserSheet({
  token,
  userId,
  onClose,
}: {
  token: string | null;
  userId: GenericId<"users">;
  onClose: () => void;
}) {
  const account = useQuery(api.admin.user, {
    token: token ?? undefined,
    userId,
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-card shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-semibold">Account</span>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {account === undefined ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : account === null ? (
            <Empty>That account no longer exists.</Empty>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold">
                  {initials(account.name, account.nexaId)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {account.name ?? "Unnamed"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {account.email ?? (account.isAnonymous ? "Guest" : "—")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Fact label="Plan" value={<PlanBadge plan={account.plan} />} />
                <Fact
                  label="Lifetime"
                  value={inr.format(account.lifetimePaise / 100)}
                />
                <Fact label="Nexa ID" value={account.nexaId ?? "—"} mono />
                <Fact label="Role" value={account.role ?? "user"} />
                <Fact label="Joined" value={ago(account.createdAt)} />
                <Fact
                  label="Last seen"
                  value={account.liveNow ? "in a room now" : ago(account.lastSeenAt)}
                />
                <Fact label="Rooms hosted" value={account.roomsHosted} />
                <Fact label="Email verified" value={account.emailVerified ? "yes" : "no"} />
              </div>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Payments
                </h3>
                {account.payments.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No payment records.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {account.payments.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block font-mono text-[11px] text-muted-foreground">
                            {row.orderId}
                          </span>
                          <span className="block text-[11px] text-muted-foreground/70">
                            {ago(row.paidAt ?? row.createdAt)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs tabular-nums">
                            {inr.format(row.amount / 100)}
                          </span>
                          <StatusBadge status={row.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Recent seats
                </h3>
                {account.recentSeats.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Has never joined a room.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {account.recentSeats.map((seat) => (
                      <li
                        key={seat.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <span className="font-mono text-muted-foreground">
                          {seat.nexaId}
                        </span>
                        <span className="text-muted-foreground">
                          {ago(seat.lastSeenAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate text-sm ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

function Panel({
  title,
  hint,
  flush = false,
  children,
}: {
  title?: string;
  hint?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-card shadow-sm ${
        flush ? "overflow-hidden" : "p-4"
      }`}
    >
      {title !== undefined && (
        <div className={flush ? "border-b border-border px-4 py-3" : ""}>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint !== undefined && (
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
