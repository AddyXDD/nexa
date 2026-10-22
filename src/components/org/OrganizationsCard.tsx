import { api } from "@/convex/_generated/api";
import { PLANS } from "@/shared/constants";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Link } from "react-router";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * Organizations on the dashboard: the entry point into each workspace, and —
 * for accounts that do not have one yet — the Business upgrade offer.
 */
export function OrganizationsCard() {
  const mine = useQuery(api.organizations.mine);

  if (mine === undefined) {
    return (
      <section className="mt-4 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading workspaces…
        </div>
      </section>
    );
  }

  const organizations = mine?.organizations ?? [];

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Building2 className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Organizations</h3>
            <p className="text-xs text-muted-foreground">
              Shared workspaces for teams, on Business and Enterprise.
            </p>
          </div>
        </div>
        <Link
          to="/org/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" /> New workspace
        </Link>
      </div>

      {organizations.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {organizations.map((org) => {
            const active = org.entitlement.status === "active";
            const grace = org.entitlement.status === "grace";
            return (
              <li key={org.id}>
                <Link
                  to={`/org/${org.slug}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {org.name}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {org.role}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="size-3" />
                      {org.memberCount}/{org.seatLimit} seats
                      <span aria-hidden="true">·</span>
                      {active
                        ? `${org.entitlement.planName} active`
                        : grace
                          ? "Renewal due"
                          : "Not subscribed"}
                    </span>
                  </span>
                  {active ? (
                    <CheckCircle2 className="size-4 shrink-0 text-[color:var(--nexa-accent)]" />
                  ) : (
                    <ShieldAlert className="size-4 shrink-0 text-amber-500" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            Meet as a team, from {inr.format(PLANS.business.pricePaise / 100)} a
            month.
          </p>
          <ul className="mt-2 grid gap-1.5 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
            <li>100 participants in Business, unlimited on Enterprise</li>
            <li>Shared meeting discovery for verified members</li>
            <li>Roles, invitations and seat management</li>
            <li>Private meetings that membership alone cannot open</li>
          </ul>
          <Link
            to="/org/new"
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            Start a workspace <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}
    </section>
  );
}
