import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import { GoogleMark } from "@/components/GoogleMark";
import { NexaMark } from "@/components/NexaMark";
import { ArrowRight, Loader2, Mail, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

/**
 * Attach this attempt's destination to the sign-in params.
 *
 * Convex Auth resolves a missing `redirectTo` against the deployment's
 * `SITE_URL`, a value that is rewritten on every deploy. Sending the path
 * explicitly keeps the destination on the published origin, where the
 * server pins it (`convex/site.ts`).
 */
function withRedirect(formData: FormData, redirect: string): FormData {
  formData.set("redirectTo", redirect);
  return formData;
}

/**
 * Marker left behind while the browser is away at Google.
 *
 * Convex Auth brings the browser back to the app with no `code` and no error
 * parameter when consent is denied, the state check fails, or the code
 * exchange fails — the page would look untouched. This flag is how the screen
 * tells "came back without finishing" apart from "just arrived", so a
 * cancelled sign-in gets an explanation instead of silence.
 */
const GOOGLE_PENDING_KEY = "nexa.google-sign-in-pending";

const GOOGLE_INCOMPLETE =
  "Google sign-in didn't complete — it may have been cancelled or interrupted. Try again, or continue with your email below.";

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Anything in flight: every control stays disabled until it settles. */
  const busy = isLoading || googleLoading;

  /**
   * A Google attempt that came back without a session.
   *
   * The marker is read once, at mount. Whether to *show* the notice is then
   * derived from the auth state rather than pushed into state by an effect —
   * which also keeps it from flashing while a successful sign-in finishes.
   */
  const [googleInterrupted, setGoogleInterrupted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(GOOGLE_PENDING_KEY) === "1";
  });
  const shownError =
    error ??
    (googleInterrupted && !authLoading && !isAuthenticated
      ? GOOGLE_INCOMPLETE
      : null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  /**
   * Retire the marker once auth has settled. The notice above is derived from
   * state by then, so nothing on disk is needed any more — and a stale flag
   * must not resurface on a later visit to this screen.
   */
  useEffect(() => {
    if (!authLoading) window.sessionStorage.removeItem(GOOGLE_PENDING_KEY);
  }, [authLoading]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleInterrupted(false);
    setGoogleLoading(true);
    try {
      // The browser is about to leave for accounts.google.com; the marker
      // survives the round trip and is read by the effect above.
      window.sessionStorage.setItem(GOOGLE_PENDING_KEY, "1");
      // `redirectTo` is a path, and it is what brings the browser back to the
      // page that asked for sign-in. Without it Convex Auth's callback returns
      // to `SITE_URL` itself — the site root — so someone who came here to
      // reach /dashboard would land on the landing page instead. It must stay
      // a same-site path: the server rejects anything else.
      await signIn("google", { redirectTo: redirect });
    } catch (googleError) {
      // The request never left — missing credentials, no network, provider
      // not registered. Report it; never fall back to email silently.
      window.sessionStorage.removeItem(GOOGLE_PENDING_KEY);
      console.error("Google sign-in error:", googleError);
      setError(
        googleError instanceof Error && googleError.message
          ? `Google sign-in could not start: ${googleError.message}`
          : "Google sign-in could not start. Please try again.",
      );
    } finally {
      // A no-op if the browser is already navigating; the guarantee is that a
      // resolved call can never leave the button stuck.
      setGoogleLoading(false);
    }
  };

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setGoogleInterrupted(false);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", withRedirect(formData, redirect));
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", withRedirect(formData, redirect));

      console.log("signed in");

      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);

      setError("The verification code you entered is incorrect.");
      setIsLoading(false);

      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    setGoogleInterrupted(false);
    try {
      console.log("Attempting anonymous sign in...");
      await signIn("anonymous");
      console.log("Anonymous sign in successful");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      setError(`Failed to sign in as guest: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">

      
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">
        {/* 350px wide as before, but capped to the viewport: the old
            `min-w-[350px]` overflowed a 320px phone by 30px. */}
        <Card className="w-[350px] max-w-[calc(100vw-2rem)] pb-0 border shadow-md">
          {step === "signIn" ? (
            <>
              <CardHeader className="text-center">                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => navigate("/")}
                      aria-label="Nexa Meet — back to home"
                      className="mb-4 mt-4 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
                    >
                      <NexaMark className="size-16" />
                    </button>
                  </div>
                <CardTitle className="text-xl">Welcome to Nexa Meet</CardTitle>
                <CardDescription>
                  Sign in with Google or an email address to keep your
                  meetings and billing in one place. You never need an account
                  to join a room — guests walk straight in.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleEmailSubmit}>
                <CardContent>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleGoogleSignIn}
                    disabled={busy}
                    aria-busy={googleLoading}
                  >
                    {googleLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting to Google…
                      </>
                    ) : (
                      <>
                        <GoogleMark className="mr-2 h-4 w-4" />
                        Continue with Google
                      </>
                    )}
                  </Button>

                  <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
                    By continuing you agree to our{" "}
                    <a
                      href="/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Terms
                    </a>{" "}
                    and{" "}
                    <a
                      href="/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Privacy Policy
                    </a>
                    , which explains what Nexa receives from Google when you
                    sign in.
                  </p>

                  <div
                    role="separator"
                    aria-label="or continue with email"
                    className="relative my-4"
                  >
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">
                        OR
                      </span>
                    </div>
                  </div>

                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        className="pl-9"
                        disabled={busy}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      size="icon"
                      disabled={busy}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {shownError && (
                    <p role="alert" className="mt-2 text-sm text-red-500">
                      {shownError}
                    </p>
                  )}
                  
                  <div className="mt-4">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">
                          Or
                        </span>
                      </div>
                    </div>
                    
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full mt-4"
                      onClick={handleGuestLogin}
                      disabled={busy}
                    >
                      <UserX className="mr-2 h-4 w-4" />
                      {isLoading ? "Preparing guest session…" : "Continue as guest"}
                    </Button>
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      No email needed: guests get their own Nexa ID and can
                      start or join meetings right away.
                    </p>
                  </div>
                </CardContent>
              </form>
            </>
          ) : (
            <>
              <CardHeader className="text-center mt-4">
                <CardTitle>Check your email</CardTitle>
                <CardDescription>
                  We&apos;ve sent a 6-digit code to {step.email}. It expires in
                  15 minutes.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleOtpSubmit}>
                <CardContent className="pb-4">
                  <input type="hidden" name="email" value={step.email} />
                  <input type="hidden" name="code" value={otp} />

                  <div className="flex justify-center">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={busy}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                          // Find the closest form and submit it
                          const form = (e.target as HTMLElement).closest("form");
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {error && (
                    <p
                      role="alert"
                      className="mt-2 text-sm text-red-500 text-center"
                    >
                      {error}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    Didn't receive a code?{" "}
                    <Button
                      variant="link"
                      className="p-0 h-auto"
                      onClick={() => setStep("signIn")}
                    >
                      Try again
                    </Button>
                  </p>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={busy || otp.length !== 6}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        Verify code
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep("signIn")}
                    disabled={busy}
                    className="w-full"
                  >
                    Use different email
                  </Button>
                </CardFooter>
              </form>
            </>
          )}

          <div className="py-4 px-6 text-xs text-center text-muted-foreground bg-muted border-t rounded-b-lg">
            Secured by{" "}
            <a
              href="https://freebuff.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary transition-colors"
            >
              freebuff.com
            </a>
          </div>
        </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
