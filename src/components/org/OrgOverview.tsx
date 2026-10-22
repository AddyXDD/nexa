import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarClock,
  CreditCard,
  Loader2,
  Lock,
  Plus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { CreateOrgMeetingDialog } from "./CreateOrgMeetingDialog";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function OrgOverview({
  slug,
  memberCount,
  seatLimit,
  canCreate,
  canManageBilling,
  planName,
}: {
  slug: string;
  memberCount: number;
  seatLimit: number;
  canCreate: boolean;
  canManageBilling: boolean;
  planName: string | null;
}) {
  const overview = useQuery(api.organizations.overview, { slug });
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Upcoming meetings</h2>
            <Link
              to={`/org/${slug}/meetings`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              All meetings <ArrowRight className="size-3" />
            </Link>
          </div>

          {overview === undefined ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : overview.upcoming.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center">
              <CalendarClock className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Nothing scheduled</p>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                {canCreate
                  ? "Open a room now and it appears here for everyone who is allowed to see it."
                  : "Meetings created by the team will appear here."}
              </p>
              {canCreate && (
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="size-3.5" /> New meeting
                </Button>
              )}
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {overview.upcoming.map((meeting) => (
                <li
                  key={meeting.id}
                  className="flex flex-wrap items-center gap-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {meeting.title ?? "Untitled meeting"}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                          meeting.visibility === "private"
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "bg-[color:var(--nexa-accent)]/10 text-[color:var(--nexa-accent)]"
                        }`}
                      >
                        {meeting.visibility === "private" ? (
                          <Lock className="size-2.5" />
                        ) : null}
                        {meeting.visibility}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {dateTime.format(new Date(meeting.startsAt))}
                      {meeting.organizerName
                        ? ` · ${meeting.organizerName}`
                        : ""}
                    </span>
                  </span>
                  <Link
                    to={`/m/${meeting.formattedCode}`}
                    className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    Join
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {overview !== undefined && overview.recent.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Recent</h2>
              <Link
                to={`/org/${slug}/meetings?scope=past`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Past meetings
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {overview.recent.map((meeting) => (
                <li
                  key={meeting.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="truncate text-sm">
                    {meeting.title ?? "Untitled meeting"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {dateTime.format(new Date(meeting.startsAt))}
                    {meeting.status === "cancelled" ? " · cancelled" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">This workspace</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="size-3.5" /> Members
              </dt>
              <dd className="font-medium tabular-nums">
                {memberCount} / {seatLimit}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <CreditCard className="size-3.5" /> Plan
              </dt>
              <dd className="font-medium">{planName ?? "Not subscribed"}</dd>
            </div>
          </dl>
          <div className="mt-4 space-y-2">
            {canCreate && (
              <Button
                className="w-full justify-start"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" /> New meeting
              </Button>
            )}
            <Link
              to={`/org/${slug}/members`}
              className="inline-flex h-9 w-full items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted"
            >
              <Users className="size-4" /> Invite members
            </Link>
            {canManageBilling && (
              <Link
                to={`/org/${slug}/settings`}
                className="inline-flex h-9 w-full items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted"
              >
                <CreditCard className="size-4" /> Billing & settings
              </Link>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-semibold">Who can see what</h2>
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <li>
              <strong className="font-medium text-foreground">Organization</strong>{" "}
              meetings are visible to every active, verified member.
            </li>
            <li>
              <strong className="font-medium text-foreground">Private</strong>{" "}
              meetings are visible only to the organizer and the members they
              explicitly add.
            </li>
            <li>
              The meeting link never bypasses these checks — they run on every
              join and every reconnect.
            </li>
          </ul>
        </section>
      </div>

      <CreateOrgMeetingDialog
        slug={slug}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
