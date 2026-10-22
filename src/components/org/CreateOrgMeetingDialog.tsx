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
import { formatMeetingCode, type MeetingVisibility } from "@/shared/constants";
import { useMutation, useQuery } from "convex/react";
import { Building2, Loader2, Lock, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

const DURATIONS = [
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 480, label: "8 hours" },
] as const;

const VISIBILITY_OPTIONS: {
  value: Exclude<MeetingVisibility, "personal">;
  label: string;
  description: string;
  icon: typeof Building2;
}[] = [
  {
    value: "organization",
    label: "Organization",
    description: "Every verified member can find and join this meeting.",
    icon: Building2,
  },
  {
    value: "private",
    label: "Private",
    description:
      "Only you and the members you pick below. Membership alone is not enough.",
    icon: Lock,
  },
];

/**
 * Create an organization meeting.
 *
 * Visibility is part of the creation form, not a label added afterwards, so
 * the organizer always knows who can discover the room. The server validates
 * the mode and the access list again.
 */
export function CreateOrgMeetingDialog({
  slug,
  open,
  onOpenChange,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMeeting = useMutation(api.organizations.createMeeting);
  const members = useQuery(api.organizations.members, { slug });
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [visibility, setVisibility] =
    useState<Exclude<MeetingVisibility, "personal">>("organization");
  const [duration, setDuration] = useState<number>(60);
  const [participants, setParticipants] = useState<Id<"users">[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleParticipant = (userId: Id<"users">) => {
    setParticipants((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createMeeting({
        slug,
        title: title.trim(),
        visibility,
        durationMinutes: duration,
        ...(visibility === "private" ? { participantIds: participants } : {}),
      });
      toast.success(
        visibility === "private"
          ? "Private meeting created. Only you and your invited members can join."
          : "Organization meeting created.",
      );
      onOpenChange(false);
      setTitle("");
      setParticipants([]);
      navigate(`/m/${formatMeetingCode(result.code)}`);
    } catch (err) {
      setError(
        friendlyError(err, "The meeting couldn't be created. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New organization meeting</DialogTitle>
          <DialogDescription>
            Everyone who can join is decided by the visibility you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Meeting title
            </label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Weekly product sync"
              maxLength={120}
              className="mt-1.5"
              autoFocus
            />
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Visibility
            </span>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {VISIBILITY_OPTIONS.map((option) => {
                const selected = visibility === option.value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVisibility(option.value)}
                    aria-pressed={selected}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? "border-[color:var(--nexa-accent)] bg-[color:var(--nexa-accent)]/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="size-3.5" /> {option.label}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Length
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {DURATIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDuration(option.value)}
                  aria-pressed={duration === option.value}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    duration === option.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              The workspace plan&apos;s time limit still applies.
            </p>
          </div>

          {visibility === "private" && (
            <div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Users className="size-3.5" /> Who can join
              </span>
              <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {(members?.members ?? []).map((member) => (
                  <label
                    key={member.userId}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={participants.includes(member.userId)}
                      onChange={() => toggleParticipant(member.userId)}
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
                {(members?.members.length ?? 0) === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    No other members yet.
                  </p>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                You can add more people later from the meetings page. You
                always have access as the organizer.
              </p>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || title.trim().length < 2}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Creating…
              </>
            ) : (
              "Create and join"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
