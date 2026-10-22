import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { friendlyError } from "@/lib/errors";
import {
  CHECKOUT_DISMISSED,
  payWithRazorpay,
  type CheckoutOrder,
} from "@/lib/razorpay";
import {
  CHECKOUT_PLANS,
  PAID_PLAN_IDS,
  type PaidPlanId,
} from "@/shared/constants";
import { useAction } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const PLAN_POINTS: Record<PaidPlanId, string[]> = {
  business: [
    "100 participants per meeting",
    "8-hour meetings",
    "Up to 25 workspace seats",
  ],
  enterprise: [
    "Unlimited participants",
    "No meeting time limit",
    "Up to 100 workspace seats",
  ],
};

/**
 * Plan picker + checkout for an organization.
 *
 * The amount and plan id are chosen on the server from the plan enum; this
 * component only displays the catalogue and opens Razorpay. Nothing here can
 * turn into an active subscription without a verified payment signature.
 */
export function PlanCheckout({
  organizationId,
  contactEmail,
  currentPlanId,
  onPaid,
}: {
  organizationId: Id<"organizations">;
  contactEmail?: string | null;
  currentPlanId?: PaidPlanId | null;
  onPaid: () => void;
}) {
  const createOrder = useAction(api.billing.createOrder);
  const verifyPayment = useAction(api.billing.verifyPayment);
  const [planId, setPlanId] = useState<PaidPlanId>(
    currentPlanId === "enterprise" ? "enterprise" : "business",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const order: CheckoutOrder = await createOrder({
        planId,
        organizationId,
      });
      await payWithRazorpay({
        order,
        description: `${CHECKOUT_PLANS[planId].name} — workspace plan`,
        email: contactEmail,
        onPaid: async (payment) => {
          await verifyPayment(payment);
        },
      });
      toast.success(`${CHECKOUT_PLANS[planId].name} is active for this workspace.`);
      onPaid();
    } catch (err) {
      if (err instanceof Error && err.message === CHECKOUT_DISMISSED) return;
      setError(
        friendlyError(
          err,
          err instanceof Error ? err.message : "The payment couldn't be completed.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PAID_PLAN_IDS.map((option) => {
          const plan = CHECKOUT_PLANS[option];
          const selected = planId === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setPlanId(option)}
              aria-pressed={selected}
              className={`rounded-xl border p-4 text-left transition-colors ${
                selected
                  ? "border-[color:var(--nexa-accent)] bg-[color:var(--nexa-accent)]/5"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
            >
              <span className="flex items-center justify-between">
                <span className="text-sm font-semibold">{plan.name}</span>
                <span className="flex size-4 items-center justify-center rounded-full border border-border">
                  {selected && <Check className="size-3" />}
                </span>
              </span>
              <span className="mt-2 block text-2xl font-semibold tracking-tight tabular-nums">
                {inr.format(plan.amountPaise / 100)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  / month
                </span>
              </span>
              <ul className="mt-3 space-y-1.5">
                {PLAN_POINTS[option].map((point) => (
                  <li
                    key={point}
                    className="text-xs leading-relaxed text-muted-foreground"
                  >
                    {point}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        One workspace per subscription. Each period is 30 days; renew any time.
        Members keep their own personal plan — a workspace purchase never
        changes anyone&apos;s personal account. Razorpay processes the payment;
        Nexa never sees card details.
      </p>

      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Opening checkout…
          </>
        ) : (
          `Subscribe — ${inr.format(CHECKOUT_PLANS[planId].amountPaise / 100)} / month`
        )}
      </button>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </div>
  );
}
