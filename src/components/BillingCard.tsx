import { api } from "@/convex/_generated/api";
import { friendlyError } from "@/lib/errors";
import { PAYMENT_NOT_CONFIGURED, RAZORPAY_PLAN } from "@/shared/constants";
import { useAction, useQuery } from "convex/react";
import { CheckCircle2, CreditCard, Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Billing: the Nexa Meet Business plan, paid through Razorpay.
 *
 * The whole flow is real — order created server-side, Razorpay Checkout
 * opened in the browser, signature verified on the server. When the
 * deployment has no Razorpay keys yet, the card says exactly that instead
 * of pretending to work.
 */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, callback: (response: unknown) => void) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Checkout requires a browser."));
  }
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("The payment window couldn't load. Check your connection."));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

type CheckoutOrder = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

export function BillingCard({
  contactEmail,
}: {
  contactEmail?: string | null;
}) {
  const status = useQuery(api.billingStore.status);
  const createOrder = useAction(api.billing.createOrder);
  const verifyPayment = useAction(api.billing.verifyPayment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === undefined) {
    return (
      <CardShell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading billing…
        </div>
      </CardShell>
    );
  }

  const startCheckout = async () => {
    setError(null);
    setBusy(true);
    try {
      const order: CheckoutOrder = await createOrder({});
      await openCheckout(order);
      toast.success("Payment confirmed. Your Business plan is active.");
    } catch (err) {
      const message =
        err instanceof Error && err.message === "checkout-dismissed"
          ? null
          : friendlyError(err, err instanceof Error ? err.message : "The payment couldn't be completed.");
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  };

  const openCheckout = async (order: CheckoutOrder) => {
    await loadRazorpayScript();
    if (!window.Razorpay) {
      throw new Error("The payment window couldn't load. Check your connection.");
    }
    await new Promise<void>((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Nexa Meet",
        description: RAZORPAY_PLAN.name,
        order_id: order.orderId,
        theme: { color: "#16161A" },
        prefill: contactEmail ? { email: contactEmail } : undefined,
        handler: (response: unknown) => {
          const payload = response as {
            razorpay_order_id?: string;
            razorpay_payment_id?: string;
            razorpay_signature?: string;
          };
          if (
            !payload.razorpay_order_id ||
            !payload.razorpay_payment_id ||
            !payload.razorpay_signature
          ) {
            reject(new Error("Payment verification failed."));
            return;
          }
          void verifyPayment({
            orderId: payload.razorpay_order_id,
            paymentId: payload.razorpay_payment_id,
            signature: payload.razorpay_signature,
          })
            .then(() => resolve())
            .catch((err: unknown) =>
              reject(
                err instanceof Error
                  ? err
                  : new Error("Payment verification failed."),
              ),
            );
        },
        modal: {
          ondismiss: () => reject(new Error("checkout-dismissed")),
          escape: true,
          confirm_close: true,
        },
      });
      rzp.on("payment.failed", (response: unknown) => {
        const payload = response as {
          error?: { description?: string };
        };
        reject(
          new Error(
            payload.error?.description ?? "The payment didn't go through.",
          ),
        );
      });
      rzp.open();
    });
  };

  if (!status.configured) {
    return (
      <CardShell>
        <CardHeading
          icon={<Lock className="size-4" />}
          title="Checkout not configured"
        />
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {PAYMENT_NOT_CONFIGURED}
        </p>
        <code className="mt-3 block rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">
          RAZORPAY_KEY_ID · RAZORPAY_KEY_SECRET
        </code>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <CardHeading
        icon={<CreditCard className="size-4" />}
        title={RAZORPAY_PLAN.name}
      />

      {status.active ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[color:var(--nexa-accent)]/30 bg-[color:var(--nexa-accent)]/10 px-3 py-2 text-sm">
          <CheckCircle2 className="size-4 text-[color:var(--nexa-accent)]" />
          <span>
            Active until{" "}
            <strong className="font-semibold">
              {new Date(status.activeUntil ?? 0).toLocaleDateString([], {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </strong>
          </span>
        </div>
      ) : (
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight">
            {inr.format(RAZORPAY_PLAN.amountPaise / 100)}
          </span>
          <span className="text-sm text-muted-foreground">/ month</span>
        </div>
      )}

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {RAZORPAY_PLAN.description} Payments are processed by Razorpay; Nexa
        Meet never sees your card details.
      </p>

      <button
        type="button"
        onClick={() => void startCheckout()}
        disabled={busy}
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Opening checkout…
          </>
        ) : status.active ? (
          "Renew for another period"
        ) : (
          "Continue to payment"
        )}
      </button>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {status.payments.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Payment history
          </h4>
          <ul className="mt-2 space-y-1.5">
            {status.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-muted-foreground">
                  {new Date(payment.paidAt ?? payment.createdAt).toLocaleDateString()}
                </span>
                <span className="font-medium tabular-nums">
                  {inr.format(payment.amount / 100)}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 font-medium ${
                    payment.status === "paid"
                      ? "bg-[color:var(--nexa-accent)]/15 text-[color:var(--nexa-accent)]"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {payment.status === "paid"
                    ? "Paid"
                    : payment.status === "failed"
                      ? "Failed"
                      : "Initiated"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardShell>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      {children}
    </section>
  );
}

function CardHeading({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  );
}
