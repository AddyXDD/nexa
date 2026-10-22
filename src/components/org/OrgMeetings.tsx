import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { friendlyError } from "@/lib/errors";
import { useMutation, useQuery } from "convex/react";
import {
  Building2,
  CalendarClock,
  Copy,
  Loader2,
  Lock,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { CreateOrgMeetingDialog } from "./CreateOrgMeetingDialog";

type Scope = "upcoming" | "past" | "all";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function VisibilityBadge({ visibility }: { visibility: string }) {
  const privateMeeting = visibility === "private";
  const Icon = privateMeeting ? Lock : Building2;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        privateMeeting
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-[color:var(--nexa-accent)]/10 text-[color:var(--nexa-accent)]"
      }`}
    >
      <Icon className="size-2.5" />
      {privateMeeting ? "Private" : "Organization"}
    </span>
  );
}

export function OrgMeetings({
  slug,
  canCreate,
  isManager,
  myUserId,
}: {
  slug: string;
  canCreate: boolean;
  isManager: boolean;
  myUserId: string;
}) {
  const [params] = useSearchParams();
  const initialScope = params.get("scope");
  const [scope, setScope] = useState<Scope>(
    initialScope === "past" ? "past" : initialScope === "all" ? "all" : "upcoming",
  );
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const meetings = useQuery(api.organizations.meetings, {
    slug,
    scope,
    search: search.trim() || undefined,
  });
  const cancelMeeting = useMutation(api.organizations.cancelMeeting);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const copyLink = async (formattedCode: string) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/m/${formattedCode}`,
      );
      toast.success("Meeting link copied.");
    } catch {
      toast.error("The link couldn't be copied.");
    }
  };

  const cancel = async (code: string) => {
    if (!window.confirm("Cancel this meeting? Members will no longer join it.")) {
      return;
    }
    setBusyCode(code);
    try {
      await cancelMeeting({ slug, code });
      toast.success("Meeting cancelled.");
    } catch (err) {
      toast.error(friendlyError(err, "The meeting couldn't be cancelled."));
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or code"
            aria-label="Search organization meetings"
            className="pl-9"
          />
          {search.length > 0 && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {(["upcoming", "past", "all"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setScope(option)}
              aria-pressed={scope === option}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                scope === option
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New meeting
          </Button>
        )}
      </div>

      {!canCreate && (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          New organization meetings are paused until the workspace subscription
          is active, or because members cannot create meetings here.
        </p>
      )}

      {meetings === undefined ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading meetings…
        </div>
      ) : meetings.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center">
          <CalendarClock className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            {scope === "past" ? "No past meetings" : "No meetings here yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            {canCreate
              ? "Create one and every member who is allowed to see it will find it here."
              : "Meetings created by workspace members will appear here."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {meetings.map((meeting) => {
            const cancelled = meeting.status === "cancelled";
            const organizer =
              meeting.organizerName ?? meeting.organizerUserId.slice(-6);
            return (
              <li
                key={meeting.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">
                        {meeting.title ?? "Untitled meeting"}
                      </h3>
                      <VisibilityBadge visibility={meeting.visibility} />
                      {cancelled && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Cancelled
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dateTime.format(new Date(meeting.startsAt))} ·{" "}
                      {meeting.durationMinutes} min · organized by {organizer}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {meeting.formattedCode}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyLink(meeting.formattedCode)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs transition-colors hover:bg-muted"
                    >
                      <Copy className="size-3" /> Link
                    </button>
                    {meeting.visibility === "private" &&
                      (isManager || meeting.organizerUserId === myUserId) && (
                        <GrantAccess slug={slug} code={meeting.code} />
                      )}
                    {!cancelled && scope !== "past" && (
                      <Link
                        to={`/m/${meeting.formattedCode}`}
                        className="inline-flex h-8 items-center rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
                      >
                        Join
                      </Link>
                    )}
                    {(isManager || meeting.organizerUserId === myUserId) &&
                      !cancelled && (
                        <button
                          type="button"
                          onClick={() => void cancel(meeting.code)}
                          disabled={busyCode === meeting.code}
                          className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          {busyCode === meeting.code ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            "Cancel"
                          )}
                        </button>
                      )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateOrgMeetingDialog
        slug={slug}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}

/** Add members to a private meeting's explicit access list. */
function GrantAccess({ slug, code }: { slug: string; code: string }) {
  const members = useQuery(api.organizations.members, { slug });
  const grant = useMutation(api.organizations.grantMeetingAccess);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Id<"users">[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await grant({ slug, code, participantIds: selected });
      toast.success(
        result.added > 0
          ? `${result.added} member${result.added === 1 ? "" : "s"} added.`
          : "Nobody new to add.",
      );
      setOpen(false);
      setSelected([]);
    } catch (err) {
      toast.error(friendlyError(err, "Access couldn't be granted."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs transition-colors hover:bg-muted"
      >
        Access
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Who else can join?</DialogTitle>
            <DialogDescription>
              This meeting is private. Workspace membership alone does not grant
              access.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {(members?.members ?? []).map((member) => (
              <label
                key={member.userId}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(member.userId)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(member.userId)
                        ? current.filter((id) => id !== member.userId)
                        : [...current, member.userId],
                    )
                  }
                  className="size-3.5"
                />
                <span className="truncate">
                  {member.name ?? member.nexaId ?? "Member"}
                </span>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                  {member.role}
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={busy || selected.length === 0}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Add members"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
