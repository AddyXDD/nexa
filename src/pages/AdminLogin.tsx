import { NexaMark } from "@/components/NexaMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { friendlyError } from "@/lib/errors";
import { useAdminSession, useAdminToken } from "@/hooks/use-admin-session";
import { useAction } from "convex/react";
import { ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";

/**
 * /admin/login — the administrator's own front door.
 *
 * Nothing in Nexa links here, and nothing here links back into the product:
 * this is a separate credential system from customer accounts, so it must
 * never look or feel like part of the meeting app. There is no "sign up"
 * and no "forgot password" — an administrator account is created once, by
 * hand, at /admin/setup.
 */
export default function AdminLogin() {
  const navigate = useNavigate();
  const { token, store } = useAdminToken();
  const session = useAdminSession(token);
  const login = useAction(api.adminAuth.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already holding a live token: go straight through.
  if (session !== undefined && session !== null) {
    return <Navigate to="/admin" replace />;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await login({ email, password });
      store(result.token);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(friendlyError(err, "Sign-in failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0c0e] px-5 text-[#f4f4f5]">
      {/* A single quiet source of light behind the card — the deck's own
          accent, barely there. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% -10%, rgba(124,140,240,0.16), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <NexaMark className="size-11" />
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#7c8cf0]/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9aa9f5] ring-1 ring-[#7c8cf0]/25">
            <ShieldCheck className="size-3" />
            Control
          </span>
          <h1 className="mt-4 text-lg font-semibold tracking-tight">
            Administrator sign-in
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#a1a1aa]">
            This account is separate from every Nexa account.
          </p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="rounded-2xl border border-white/10 bg-[#141517]/80 p-5 shadow-[0_32px_80px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8b8b94]">
              Email
            </span>
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-2 h-11 border-white/10 bg-white/[0.03] text-[#f4f4f5] placeholder:text-[#5c5c66] focus-visible:ring-[#7c8cf0]/50"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8b8b94]">
              Password
            </span>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••"
              className="mt-2 h-11 border-white/10 bg-white/[0.03] text-[#f4f4f5] placeholder:text-[#5c5c66] focus-visible:ring-[#7c8cf0]/50"
            />
          </label>

          {error !== null && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[13px] leading-relaxed text-red-300"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={busy}
            className="mt-5 h-11 w-full bg-[#f4f4f5] font-medium text-[#0b0c0e] hover:bg-white disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <KeyRound className="size-4" />
                Sign in
                <ArrowRight className="ml-auto size-4 opacity-60" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-[#5c5c66]">
          Sessions last 12 hours and are held only in this browser.
        </p>
      </div>
    </main>
  );
}
