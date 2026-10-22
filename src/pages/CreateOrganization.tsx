import { api } from "@/convex/_generated/api";
import { NexaLogo } from "@/components/NexaMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/errors";
import {
  normalizeOrganizationSlug,
  ORGANIZATIONS,
  PLANS,
} from "@/shared/constants";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Building2,
  Check,
  Loader2,
  Lock,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * Creating a workspace is free; using it is not.
 *
 * The workspace exists immediately so its owner can pay for it, but no
 * organization feature works until a verified payment activates the plan.
 */
export default function CreateOrganization() {
  const create = useMutation(api.organizations.create);
  const mine = useQuery(api.organizations.mine);
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The address follows the workspace name until it is edited by hand.
  const slug = customSlug ?? normalizeOrganizationSlug(name);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await create({ name: name.trim(), slug });
      toast.success("Workspace created. Add a plan to start meeting.");
      navigate(`/org/${result.slug}/settings`);
    } catch (err) {
      setError(friendlyError(err, "The workspace couldn't be created."));
    } finally {
      setBusy(false);
    }
  };

  const verified = mine?.personal.verified ?? false;
  const existing = mine?.organizations.length ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Nexa Meet home">
            <NexaLogo markClassName="size-6" />
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            New workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Bring your team into one place.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A Nexa organization gives verified teammates a shared space to find
            meetings, keep private rooms private, and manage who belongs — all
            on the same temporary-room foundation as your personal meetings.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Organization name
              </label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Design"
                maxLength={64}
                required
                className="mt-1.5"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Workspace address
              </label>
              <div className="mt-1.5 flex items-center rounded-lg border border-border bg-muted/40 pl-3">
                <span className="text-xs text-muted-foreground">
                  nexameet.in/org/
                </span>
                <Input
                  value={slug}
                  onChange={(event) => {
                    setCustomSlug(event.target.value);
                  }}
                  placeholder="acme-design"
                  maxLength={32}
                  required
                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                3–32 lower-case letters, numbers or hyphens. It must be unique.
              </p>
            </div>

            {!verified && mine !== undefined && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Lock className="size-3.5" /> Verify your email first
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {ORGANIZATIONS.unverified}
                </p>
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <Button
              type="submit"
              disabled={busy || name.trim().length < 2 || slug.length < 3}
              className="w-full sm:w-auto"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Building2 className="size-4" /> Create workspace
                </>
              )}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Creating is free. Organization features activate after a real
              Razorpay payment for the workspace. No payment is simulated.
            </p>
          </form>

          {existing > 0 && (
            <p className="mt-5 text-xs text-muted-foreground">
              You already belong to {existing} workspace
              {existing === 1 ? "" : "s"}. You can switch between them from the
              dashboard.
            </p>
          )}
        </section>

        <aside className="space-y-3">
          {(["business", "enterprise"] as const).map((planId) => {
            const plan = PLANS[planId];
            return (
              <div
                key={planId}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">{plan.name}</h2>
                  <span className="text-xl font-semibold tabular-nums">
                    {inr.format(plan.pricePaise / 100)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      /month
                    </span>
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <Users className="size-3" />
                    {plan.organizationSeats} workspace seats
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="size-3" />
                    {plan.maxParticipants === null
                      ? "Unlimited participants"
                      : `${plan.maxParticipants} participants`}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="size-3" />
                    {plan.maxMeetingHours === null
                      ? "No meeting time limit"
                      : `${plan.maxMeetingHours}-hour meetings`}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="size-3" />
                    Organization meetings, private rooms and roles
                  </li>
                </ul>
              </div>
            );
          })}
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            Seats are part of the plan, not a promise: Business includes{" "}
            {PLANS.business.organizationSeats} and Enterprise{" "}
            {PLANS.enterprise.organizationSeats}. A workspace purchase does not
            change any member&apos;s personal plan.
          </p>
        </aside>
      </main>
    </div>
  );
}
