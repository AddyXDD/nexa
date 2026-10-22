import { api } from "@/convex/_generated/api";
import { NexaLogo } from "@/components/NexaMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { friendlyError } from "@/lib/errors";
import { ORGANIZATIONS } from "@/shared/constants";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Loader2,
  MailCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

/**
 * Accept an invitation.
 *
 * The preview is public (it is what the email link opens), but acceptance
 * requires a signed-in account whose verified address matches the invitation
 * exactly. The token is single-use and is checked server-side on every call.
 */
export default function JoinOrganization() {
  const { token = "" } = useParams<{ token: string }>();
  const preview = useQuery(api.organizations.invitationPreview, { token });
  const accept = useMutation(api.organizations.acceptInvitation);
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnTo = `/org/join/${token}`;

  if (preview === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (preview === null) {
    return (
      <Shell title="Invitation not found">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {ORGANIZATIONS.inviteInvalid} Ask an owner or admin of the workspace
          for a fresh invitation.
        </p>
        <Link
          to="/dashboard"
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
        >
          Back to dashboard
        </Link>
      </Shell>
    );
  }

  const pending = preview.status === "pending";
  const signedInAsGuest = user?.isAnonymous === true;

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await accept({ token });
      toast.success(
        result.alreadyMember
          ? `You're already a member of ${preview.organizationName}.`
          : `Welcome to ${preview.organizationName}.`,
      );
      navigate(`/org/${result.slug}`);
    } catch (err) {
      setError(friendlyError(err, "The invitation couldn't be accepted."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={`Join ${preview.organizationName}`}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
        <Building2 className="size-3.5 text-muted-foreground" />
        <span className="font-mono">
          nexameet.in/org/{preview.organizationSlug}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Invited address</dt>
          <dd className="truncate font-medium">{preview.email}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Role</dt>
          <dd className="font-medium capitalize">{preview.role}</dd>
        </div>
      </dl>

      {!pending ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {preview.status === "expired"
              ? "This invitation has expired. Ask for a new one."
              : preview.status === "revoked"
                ? ORGANIZATIONS.inviteRevoked
                : "This invitation has already been used."}
          </p>
        </div>
      ) : !isAuthenticated ? (
        <div className="mt-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sign in with the invited email address to accept. Google sign-in and
            an email code both work; either way the address must be verified.
          </p>
          <Link
            to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
          >
            <MailCheck className="size-4" /> Sign in to accept
          </Link>
        </div>
      ) : signedInAsGuest ? (
        <div className="mt-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {ORGANIZATIONS.anonymous} A guest session has no verified address to
            match this invitation.
          </p>
          <Link
            to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
          >
            Sign in with the invited email <ArrowRight className="size-4" />
          </Link>
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            You&apos;re signed in
            {user?.email ? ` as ${user.email}` : ""}. The invitation only works
            if this is the address it was sent to.
          </p>
          <Button
            className="mt-3 w-full"
            onClick={() => void handleAccept()}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Accepting…
              </>
            ) : (
              <>Join {preview.organizationName}</>
            )}
          </Button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
        Accepting gives you access to this workspace&apos;s shared meetings. Your
        personal plan and personal meetings are unchanged, and organization
        membership never grants a paid personal subscription.
      </p>
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:px-6">
          <Link to="/" aria-label="Nexa Meet home">
            <NexaLogo markClassName="size-6" />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Organization invitation
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
