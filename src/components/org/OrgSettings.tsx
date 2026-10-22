import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/errors";
import { CHECKOUT_PLANS, ORGANIZATIONS, PLANS } from "@/shared/constants";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PlanCheckout } from "./PlanCheckout";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

type Entitlement = {
  planId: string;
  planName: string;
  status: string;
  activeUntil: number | null;
  seats: number;
  canCreate: boolean;
  canJoin: boolean;
  canManage: boolean;
};

export function OrgSettings({
  organizationId,
  slug,
  name,
  isOwner,
  isManager,
  entitlement,
  membersCanCreateMeetings,
  verifiedEmail,
}: {
  organizationId: Id<"organizations">;
  slug: string;
  name: string;
  isOwner: boolean;
  isManager: boolean;
  entitlement: Entitlement;
  membersCanCreateMeetings: boolean;
  verifiedEmail: string | null;
}) {
  const updateSettings = useMutation(api.organizations.updateSettings);
  const deleteOrganization = useMutation(api.organizations.deleteOrganization);
  const subscription = useQuery(
    api.organizations.subscription,
    isManager ? { slug } : "skip",
  );

  const [nameDraft, setNameDraft] = useState(name);
  const [slugDraft, setSlugDraft] = useState(slug);
  const [membersCanCreate, setMembersCanCreate] = useState(
    membersCanCreateMeetings,
  );
  const [saving, setSaving] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Server values land after first paint; seed the editor from the Convex
  // snapshot, after which the drafts belong to the person typing.
  /* eslint-disable react-hooks/set-state-in-effect -- mirrors the query snapshot into the form */
  useEffect(() => {
    setNameDraft(name);
    setSlugDraft(slug);
  }, [name, slug]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateSettings({
        slug,
        ...(nameDraft.trim() !== name ? { name: nameDraft } : {}),
        ...(isOwner && slugDraft.trim() !== slug ? { newSlug: slugDraft } : {}),
        ...(membersCanCreate !== membersCanCreateMeetings
          ? { membersCanCreateMeetings: membersCanCreate }
          : {}),
      });
      toast.success("Workspace settings saved.");
      if (result.slug !== slug) {
        window.history.replaceState({}, "", `/org/${result.slug}/settings`);
      }
    } catch (err) {
      toast.error(friendlyError(err, "The settings couldn't be saved."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteOrganization({ slug, confirmSlug });
      toast.success("Workspace deleted. Billing records are retained.");
      window.location.assign("/dashboard");
    } catch (err) {
      toast.error(friendlyError(err, "The workspace couldn't be deleted."));
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Workspace details</h2>
          <form onSubmit={save} className="mt-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Name
              </label>
              <Input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                maxLength={64}
                disabled={!isManager}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Address
              </label>
              <div className="mt-1.5 flex items-center rounded-lg border border-border bg-muted/40 pl-3">
                <span className="text-xs text-muted-foreground">
                  nexameet.in/org/
                </span>
                <Input
                  value={slugDraft}
                  onChange={(event) => setSlugDraft(event.target.value)}
                  maxLength={32}
                  disabled={!isOwner}
                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isOwner
                  ? "Changing the address breaks previously shared workspace links."
                  : "Only the owner can change the workspace address."}
              </p>
            </div>

            <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <span>
                <span className="block text-xs font-medium">
                  Members can create meetings
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  When off, only owners and admins can open organization
                  meetings. Joining is unaffected.
                </span>
              </span>
              <input
                type="checkbox"
                checked={membersCanCreate}
                onChange={(event) => setMembersCanCreate(event.target.checked)}
                disabled={!isManager || !entitlement.canManage}
                className="mt-0.5 size-4"
              />
            </label>

            {isManager ? (
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Save className="size-4" /> Save settings
                  </>
                )}
              </Button>
            ) : (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Only owners and admins can change workspace settings.
              </p>
            )}
          </form>
        </section>

        {isOwner && (
          <section className="rounded-xl border border-red-500/25 bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-red-500">
              <AlertTriangle className="size-4" /> Delete workspace
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Deletion cancels organization meetings, removes every member and
              revokes pending invitations. Payment records are retained because
              they are financial records. This cannot be undone.
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Type{" "}
              <span className="font-mono font-medium text-foreground">
                {slug}
              </span>{" "}
              to confirm.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Input
                value={confirmSlug}
                onChange={(event) => setConfirmSlug(event.target.value)}
                placeholder={slug}
                aria-label="Confirm workspace address"
                className="max-w-xs"
              />
              <Button
                variant="destructive"
                onClick={() => void remove()}
                disabled={deleting || confirmSlug.trim() !== slug}
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete
              </Button>
            </div>
          </section>
        )}
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="size-4" /> Subscription
        </h2>

        {!isManager ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Billing is managed by the workspace owner.
          </p>
        ) : subscription === undefined ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading billing…
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {entitlement.status === "active" ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--nexa-accent)]/30 bg-[color:var(--nexa-accent)]/10 px-2.5 py-1.5">
                  <CheckCircle2 className="size-3.5 text-[color:var(--nexa-accent)]" />
                  <strong className="font-semibold">
                    {entitlement.planName}
                  </strong>{" "}
                  active
                </span>
              ) : entitlement.status === "grace" ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="size-3.5" /> Renewal due
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-muted-foreground">
                  <ShieldAlert className="size-3.5" /> No active subscription
                </span>
              )}
            </div>

            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {entitlement.activeUntil
                ? `Current period ends ${date.format(new Date(entitlement.activeUntil))}.`
                : "Subscribe to unlock organization meetings, invitations and member management."}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Organization billing is separate from personal plans.{" "}
              {PLANS.business.organizationSeats} seats on Business,{" "}
              {PLANS.enterprise.organizationSeats} on Enterprise, per 30-day
              period.
            </p>

            {subscription.configured ? (
              <div className="mt-4 border-t border-border pt-4">
                <PlanCheckout
                  organizationId={organizationId}
                  contactEmail={verifiedEmail}
                  currentPlanId={
                    entitlement.planId === "enterprise" ? "enterprise" : null
                  }
                  onPaid={() => undefined}
                />
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Lock className="size-3.5" /> Checkout not configured
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Set <span className="font-mono">RAZORPAY_KEY_ID</span> and{" "}
                  <span className="font-mono">RAZORPAY_KEY_SECRET</span> in the
                  Convex environment. Until then no subscription can be
                  purchased — and none is pretended to exist.
                </p>
              </div>
            )}

            {entitlement.status !== "active" && (
              <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {ORGANIZATIONS.grace} No meeting, member or payment row is
                deleted when a period ends.
              </p>
            )}

            {subscription.payments.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payments
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {subscription.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-muted-foreground">
                        {date.format(
                          new Date(payment.paidAt ?? payment.createdAt),
                        )}
                      </span>
                      <span className="font-medium tabular-nums">
                        {inr.format(payment.amount / 100)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          payment.status === "paid"
                            ? "bg-[color:var(--nexa-accent)]/15 text-[color:var(--nexa-accent)]"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {payment.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              {CHECKOUT_PLANS.business.name}{" "}
              {inr.format(CHECKOUT_PLANS.business.amountPaise / 100)}/month ·{" "}
              {CHECKOUT_PLANS.enterprise.name}{" "}
              {inr.format(CHECKOUT_PLANS.enterprise.amountPaise / 100)}/month.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
