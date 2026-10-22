import { api } from "@/convex/_generated/api";
import { NexaLogo } from "@/components/NexaMark";
import { OrgMeetings } from "@/components/org/OrgMeetings";
import { OrgMembers } from "@/components/org/OrgMembers";
import { OrgOverview } from "@/components/org/OrgOverview";
import { OrgSettings } from "@/components/org/OrgSettings";
import { OrgSwitcher } from "@/components/org/OrgSwitcher";
import { ORGANIZATIONS, PLANS } from "@/shared/constants";
import { useQuery } from "convex/react";
import {
  ArrowLeft,
  Building2,
  Loader2,
  ShieldAlert,
  Users,
  Video,
} from "lucide-react";
import { Link, useLocation, useParams } from "react-router";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const TABS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "meetings", label: "Meetings", path: "/meetings" },
  { key: "members", label: "Members", path: "/members" },
  { key: "settings", label: "Settings", path: "/settings" },
] as const;

function tabFor(pathname: string, slug: string): string {
  const base = `/org/${slug}`;
  if (pathname.startsWith(`${base}/meetings`)) return "meetings";
  if (pathname.startsWith(`${base}/members`)) return "members";
  if (pathname.startsWith(`${base}/settings`)) return "settings";
  return "overview";
}

/**
 * Organization workspace.
 *
 * The page renders only after the server says the caller is an active member.
 * Every mutation inside re-checks that fact, so hiding a button is a courtesy,
 * never the control.
 */
export default function Organization() {
  const { slug = "" } = useParams<{ slug: string }>();
  const location = useLocation();
  const org = useQuery(api.organizations.get, { slug });

  if (org === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (org === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <ShieldAlert className="mx-auto size-6 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-semibold">Workspace unavailable</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {ORGANIZATIONS.notFound} If you were invited, open the invitation
            link that was sent to your verified email address.
          </p>
          <Link
            to="/dashboard"
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
          >
            <ArrowLeft className="size-3.5" /> Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const tab = tabFor(location.pathname, org.slug);
  const entitlement = org.entitlement;
  const active = entitlement.status === "active";
  const archived = org.status === "archived";
  const canCreate =
    active &&
    !archived &&
    (org.isManager || org.settings.membersCanCreateMeetings);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/"
              className="shrink-0 text-foreground"
              aria-label="Nexa Meet home"
            >
              <NexaLogo markClassName="size-6" />
            </Link>
            <span className="hidden h-5 w-px bg-border sm:block" />
            <span className="flex min-w-0 items-center gap-1.5 text-sm">
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{org.name}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/dashboard"
              className="hidden rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline"
            >
              Dashboard
            </Link>
            <OrgSwitcher currentSlug={org.slug} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-0.5">
                {org.role}
              </span>
              <span>nexameet.in/org/{org.slug}</span>
            </p>
            <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight">
              {org.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {org.memberCount} of {org.seatLimit} seats used
              <span aria-hidden="true"> · </span>
              {active
                ? `${org.entitlement.planName} active`
                : entitlement.status === "grace"
                  ? "Renewal due"
                  : "Not subscribed"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/org/${org.slug}/members`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted"
            >
              <Users className="size-4" /> Members
            </Link>
            <Link
              to={`/org/${org.slug}/meetings`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted"
            >
              <Video className="size-4" /> Meetings
            </Link>
          </div>
        </div>

        {archived && (
          <div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/5 p-4 text-sm leading-relaxed">
            {ORGANIZATIONS.archived} Only billing history remains available.
          </div>
        )}

        {!archived && !active && (
          <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
              {entitlement.status === "grace"
                ? "The subscription has ended"
                : "Subscribe to unlock this workspace"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {entitlement.status === "grace"
                ? ORGANIZATIONS.grace
                : `Organization meetings, invitations and member management are part of the ${
                    PLANS.business.name
                  } (${inr.format(
                    PLANS.business.pricePaise / 100,
                  )}/month) and ${PLANS.enterprise.name} (${inr.format(
                    PLANS.enterprise.pricePaise / 100,
                  )}/month) plans. Existing data is preserved; nothing is deleted.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                to={`/org/${org.slug}/settings`}
                className="inline-flex h-8 items-center rounded-lg bg-foreground px-3 text-xs font-medium text-background"
              >
                {org.role === "owner"
                  ? "Subscribe in settings"
                  : "View subscription"}
              </Link>
              <Link
                to="/dashboard"
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium"
              >
                Personal meetings still work
              </Link>
            </div>
          </div>
        )}

        <nav
          className="mt-6 flex gap-1 overflow-x-auto border-b border-border"
          aria-label="Workspace sections"
        >
          {TABS.map((item) => {
            const selected = tab === item.key;
            return (
              <Link
                key={item.key}
                to={`/org/${org.slug}${item.path}`}
                aria-current={selected ? "page" : undefined}
                className={`relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
                  selected
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
                {selected && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-5">
          {tab === "overview" && (
            <OrgOverview
              slug={org.slug}
              memberCount={org.memberCount}
              seatLimit={org.seatLimit}
              canCreate={canCreate}
              canManageBilling={org.isManager}
              planName={active ? org.entitlement.planName : null}
            />
          )}
          {tab === "meetings" && (
            <OrgMeetings
              slug={org.slug}
              canCreate={canCreate}
              isManager={org.isManager}
              myUserId={org.myUserId}
            />
          )}
          {tab === "members" && (
            <OrgMembers
              slug={org.slug}
              isOwner={org.role === "owner"}
              isManager={org.isManager}
              myUserId={org.myUserId}
              seatLimit={org.seatLimit}
              seatsUsed={org.memberCount}
              canInvite={active && !archived}
            />
          )}
          {tab === "settings" && (
            <OrgSettings
              organizationId={org.id}
              slug={org.slug}
              name={org.name}
              isOwner={org.role === "owner"}
              isManager={org.isManager}
              entitlement={org.entitlement}
              membersCanCreateMeetings={org.settings.membersCanCreateMeetings}
              verifiedEmail={org.verifiedEmail}
            />
          )}
        </div>
      </main>
    </div>
  );
}
