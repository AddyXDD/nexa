import { NexaMark } from "@/components/NexaMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { friendlyError } from "@/lib/errors";
import { useAdminToken } from "@/hooks/use-admin-session";
import { useAction } from "convex/react";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

/**
 * /admin/setup — create the very first administrator.
 *
 * Gated on ADMIN_BOOTSTRAP_TOKEN in the deployment environment, and the
 * action refuses once any admin exists, so this is a one-shot rather than a
 * back door. Set the token, run through this page once, then remove the
 * token: after that this page is permanently closed and /admin/login is the
 * only way in.
 */
export default function AdminSetup() {
  const navigate = useNavigate();
  const { store } = useAdminToken();
  const provision = useAction(api.adminAuth.provision);

  const [bootstrapToken, setBootstrapToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await provision({ bootstrapToken, email, password });
      store(result.token);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(friendlyError(err, "The account couldn't be created."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0c0e] px-5 py-10 text-[#f4f4f5]">
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
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-amber-400/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300 ring-1 ring-amber-400/25">
            <ShieldAlert className="size-3" />
            First-run setup
          </span>
          <h1 className="mt-4 text-lg font-semibold tracking-tight">
            Create the administrator
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#a1a1aa]">
            This runs once. Afterwards, remove{" "}
            <code className="font-mono text-[12px] text-[#d4d4d8]">
              ADMIN_BOOTSTRAP_TOKEN
            </code>{" "}
            and this page closes for good.
          </p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="rounded-2xl border border-white/10 bg-[#141517]/80 p-5 shadow-[0_32px_80px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <Field
            label="Setup token"
            type="password"
            value={bootstrapToken}
            onChange={setBootstrapToken}
            placeholder="ADMIN_BOOTSTRAP_TOKEN"
            autoComplete="off"
          />
          <Field
            label="Admin email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 10 characters"
            autoComplete="new-password"
          />
          <Field
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            placeholder="Type it again"
            autoComplete="new-password"
            className="mt-4"
          />

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
                Creating…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" />
                Create administrator
              </>
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-[#5c5c66]">
          The password is stored only as a PBKDF2 hash, and only this
          browser&apos;s session token is kept.
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  className = "mt-4",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8b8b94]">
        {label}
      </span>
      <Input
        type={type}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-11 border-white/10 bg-white/[0.03] text-[#f4f4f5] placeholder:text-[#5c5c66] focus-visible:ring-[#7c8cf0]/50"
      />
    </label>
  );
}
