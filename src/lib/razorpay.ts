/**
 * Razorpay Checkout, browser side.
 *
 * The order is created and verified on the server; this module only opens
 * Razorpay's widget and hands the signed result back for verification. It
 * never decides a price or a plan.
 */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, callback: (response: unknown) => void) => void;
    };
  }
}

export type CheckoutOrder = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  planName?: string;
};

export type RazorpaySuccess = {
  orderId: string;
  paymentId: string;
  signature: string;
};

export const CHECKOUT_DISMISSED = "checkout-dismissed";

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

export async function payWithRazorpay({
  order,
  description,
  email,
  onPaid,
}: {
  order: CheckoutOrder;
  description: string;
  email?: string | null;
  /** Server verification. Must reject when the signature is not valid. */
  onPaid: (payment: RazorpaySuccess) => Promise<void>;
}): Promise<void> {
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
      description,
      order_id: order.orderId,
      theme: { color: "#16161A" },
      prefill: email ? { email } : undefined,
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
        void onPaid({
          orderId: payload.razorpay_order_id,
          paymentId: payload.razorpay_payment_id,
          signature: payload.razorpay_signature,
        })
          .then(() => resolve())
          .catch((err: unknown) =>
            reject(
              err instanceof Error ? err : new Error("Payment verification failed."),
            ),
          );
      },
      modal: {
        ondismiss: () => reject(new Error(CHECKOUT_DISMISSED)),
        escape: true,
        confirm_close: true,
      },
    });
    rzp.on("payment.failed", (response: unknown) => {
      const payload = response as { error?: { description?: string } };
      reject(
        new Error(payload.error?.description ?? "The payment didn't go through."),
      );
    });
    rzp.open();
  });
}
