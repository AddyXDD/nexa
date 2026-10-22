import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/errors";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Clock,
  Copy,
  Loader2,
  Mail,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        role === "owner"
          ? "bg-foreground text-background"
          : role === "admin"
            ? "bg-[color:var(--nexa-accent)]/12 text-[color:var(--nexa-accent)]"
            : "bg-muted text-muted-foreground"
      }`}
    >
      {role}
    </span>
  );
}

export function OrgMembers({
  slug,
  isOwner,
  isManager,
  myUserId,
  seatLimit,
  seatsUsed,
  canInvite,
}: {
  slug: string;
  isOwner: boolean;
  isManager: boolean;
  myUserId: string;
  seatLimit: number;
  seatsUsed: number;
  canInvite: boolean;
}) {
  const directory = useQuery(api.organizations.members, { slug });
  const invitations = useQuery(api.organizations.invitations, { slug });
  const createInvitation = useMutation(api.organizations.createInvitation);
  const sendInvitationEmail = useAction(api.organizations.sendInvitationEmail);
  const revokeInvitation = useMutation(api.organizations.revokeInvitation);
  const removeMember = useMutation(api.organizations.removeMember);
  const changeRole = useMutation(api.organizations.changeRole);
  const transferOwnership = useMutation(api.organizations.transferOwnership);
  const leave = useMutation(api.organizations.leave);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{
    link: string;
    email: string;
  } | null>(null);

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setLastInvite(null);
    try {
      const invitation = await createInvitation({
        slug,
        email: email.trim(),
        role,
      });
      setLastInvite({ link: invitation.link, email: invitation.email });
      setEmail("");
      if (invitation.emailConfigured) {
        const result = await sendInvitationEmail({
          slug,
          invitationId: invitation.invitationId,
          token: invitation.token,
        });
        toast[result.sent ? "success" : "error"](
          result.sent
            ? `Invitation emailed to ${invitation.email}.`
            : "The email couldn't be sent. Copy the link below and share it directly.",
        );
      } else {
        toast.success("Invitation created. Copy the link and share it directly.");
      }
    } catch (err) {
      setError(
        friendlyError(err, "The invitation couldn't be created. Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const run = async (label: string, action: Promise<unknown>) => {
    try {
      await action;
      toast.success(label);
    } catch (err) {
      toast.error(friendlyError(err, "That change couldn't be saved."));
    }
  };

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied.");
    } catch {
      toast.error("The link couldn't be copied.");
    }
  };

  const pending = (invitations ?? []).filter(
    (invitation) => invitation.status === "pending",
  );
  const history = (invitations ?? []).filter(
    (invitation) => invitation.status !== "pending",
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Members</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {seatsUsed}/{seatLimit} seats
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[color:var(--nexa-accent)]"
            style={{
              width: `${Math.min(100, Math.round((seatsUsed / Math.max(1, seatLimit)) * 100))}%`,
            }}
          />
        </div>

        {directory === undefined ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading members…
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {directory.members.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center gap-3 py-2.5"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                  {(member.name ?? member.nexaId ?? "M").slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {member.name ?? "Unnamed member"}
                    </span>
                    <RoleBadge role={member.role} />
                    {member.userId === myUserId && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        you
                      </span>
                    )}
                    {!member.verified && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        unverified
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {member.nexaId ?? "No Nexa ID"}
                    {member.email ? ` · ${member.email}` : ""} · joined{" "}
                    {date.format(new Date(member.joinedAt))}
                  </span>
                </span>

                {isOwner && member.role !== "owner" && (
                  <>
                    <select
                      value={member.role}
                      onChange={(event) =>
                        void run(
                          "Role updated.",
                          changeRole({
                            slug,
                            userId: member.userId,
                            role: event.target.value as "admin" | "member",
                          }),
                        )
                      }
                      aria-label={`Role for ${member.name ?? "member"}`}
                      className="h-8 rounded-lg border border-border bg-card px-2 text-xs"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    {member.userId !== myUserId && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Make ${member.name ?? "this member"} the owner? You will become an admin.`,
                            )
                          ) {
                            void run(
                              "Ownership transferred.",
                              transferOwnership({ slug, userId: member.userId }),
                            );
                          }
                        }}
                        title="Transfer ownership"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ShieldCheck className="size-4" />
                      </button>
                    )}
                  </>
                )}

                {isManager &&
                  member.role !== "owner" &&
                  member.userId !== myUserId &&
                  (member.role === "member" || isOwner) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${member.name ?? "this member"} from the workspace? They lose access immediately, including any meeting they are in.`,
                          )
                        ) {
                          void run(
                            "Member removed.",
                            removeMember({ slug, userId: member.userId }),
                          );
                        }
                      }}
                      title="Remove member"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <UserMinus className="size-4" />
                    </button>
                  )}
              </li>
            ))}
          </ul>
        )}

        {!isOwner && (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Leave this workspace? You will lose access to its meetings.",
                )
              ) {
                void run("You left the workspace.", leave({ slug }));
              }
            }}
            className="mt-4 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Leave workspace
          </button>
        )}
      </section>

      <div className="space-y-4">
        {isManager && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <UserPlus className="size-4" /> Invite a member
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Invitations are one-use, expire in seven days, and only the
              recipient&apos;s verified email can accept them. An invitation
              never gives a personal subscription.
            </p>
            {!canInvite && (
              <p className="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Inviting resumes when the workspace subscription is active.
              </p>
            )}
            <form onSubmit={invite} className="mt-3 space-y-2">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@company.com"
                aria-label="Invitee email"
                required
              />
              {isOwner && (
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as "member" | "admin")
                  }
                  aria-label="Invitation role"
                  className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={busy || !canInvite || email.trim().length === 0}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Creating…
                  </>
                ) : (
                  <>
                    <Mail className="size-4" /> Create invitation
                  </>
                )}
              </Button>
            </form>
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

            {lastInvite && (
              <div className="mt-3 rounded-lg border border-[color:var(--nexa-accent)]/30 bg-[color:var(--nexa-accent)]/5 p-3">
                <p className="text-[11px] font-medium">
                  Link for {lastInvite.email}
                </p>
                <code className="mt-1 block break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {lastInvite.link}
                </code>
                <button
                  type="button"
                  onClick={() => void copy(lastInvite.link)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                >
                  <Copy className="size-3" /> Copy link
                </button>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  Share it only with that person. Only they can accept it.
                </p>
              </div>
            )}
          </section>
        )}

        {isManager && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">
              Pending invitations{" "}
              <span className="font-normal text-muted-foreground">
                ({pending.length})
              </span>
            </h2>
            {pending.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No invitations waiting.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {pending.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="rounded-lg border border-border p-2.5"
                  >
                    <p className="truncate text-xs font-medium">
                      {invitation.email}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Clock className="size-2.5" />
                      {invitation.role} · expires{" "}
                      {date.format(new Date(invitation.expiresAt))}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          "Invitation revoked.",
                          revokeInvitation({
                            slug,
                            invitationId: invitation.id,
                          }),
                        )
                      }
                      className="mt-1.5 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {history.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Previous invitations
                </summary>
                <ul className="mt-2 space-y-1">
                  {history.slice(0, 10).map((invitation) => (
                    <li
                      key={invitation.id}
                      className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
                    >
                      <span className="truncate">{invitation.email}</span>
                      <span className="capitalize">{invitation.status}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {!isManager && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Check className="size-4" /> Your access
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              As a member you can join organization meetings, create new ones
              when the workspace allows it, and see the member directory. Only
              owners and admins manage people, billing and invitations.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
