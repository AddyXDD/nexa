import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Meeting = lazy(() => import("./pages/Meeting.tsx"));
const Organization = lazy(() => import("./pages/Organization.tsx"));
const CreateOrganization = lazy(
  () => import("./pages/CreateOrganization.tsx"),
);
const JoinOrganization = lazy(() => import("./pages/JoinOrganization.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Terms = lazy(() => import("./pages/Terms.tsx"));
const Privacy = lazy(() => import("./pages/Privacy.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const AdminLogin = lazy(() => import("./pages/AdminLogin.tsx"));
const AdminSetup = lazy(() => import("./pages/AdminSetup.tsx"));

/** Skeleton fallback for route transitions: a plausible page structure
 *  pulsing in place instead of a bare "Loading..." label. */
function RouteLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6">
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          <div className="flex gap-3">
            <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            <div className="h-8 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-5 h-10 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * The Convex client is constructed at module scope: a missing or invalid
 * VITE_CONVEX_URL throws before React mounts, which used to leave a silent
 * white page. Catch it and render a legible configuration error instead.
 */
function createConvexClient(): ConvexReactClient | Error {
  try {
    return new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

const convex = createConvexClient();



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


const root = createRoot(document.getElementById("root")!);

if (convex instanceof Error) {
  root.render(
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          Configuration error
        </p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">
          The Convex URL is missing
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Set <span className="font-mono">VITE_CONVEX_URL</span> in your
          deployment&apos;s environment variables (it must be available during
          the build, since Vite bakes it into the bundle) and redeploy.
          Locally it lives in <span className="font-mono">.env.local</span>.
        </p>
        <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-muted p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {convex.message}
        </pre>
      </div>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <RootErrorBoundary>
        <ToolbarErrorBoundary>
          <VlyToolbar />
        </ToolbarErrorBoundary>
        <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              {/* Organizations are an authenticated, paid workspace. The
                  server decides membership and entitlement; RequireAuth only
                  handles the sign-in bounce and return path. */}
              <Route
                path="/org/new"
                element={
                  <RequireAuth
                    title="Sign in to create a workspace"
                    description="Organizations belong to an account with a verified email address."
                    redirectImmediately
                  >
                    <CreateOrganization />
                  </RequireAuth>
                }
              />
              {/* Public: the email link must open for a signed-out visitor,
                  who is then asked to sign in and brought straight back. */}
              <Route path="/org/join/:token" element={<JoinOrganization />} />
              <Route
                path="/org/:slug"
                element={
                  <RequireAuth
                    title="Sign in to open this workspace"
                    description="Organization meetings and membership are only visible to signed-in members."
                    redirectImmediately
                  >
                    <Organization />
                  </RequireAuth>
                }
              />
              <Route
                path="/org/:slug/meetings"
                element={
                  <RequireAuth redirectImmediately>
                    <Organization />
                  </RequireAuth>
                }
              />
              <Route
                path="/org/:slug/members"
                element={
                  <RequireAuth redirectImmediately>
                    <Organization />
                  </RequireAuth>
                }
              />
              <Route
                path="/org/:slug/settings"
                element={
                  <RequireAuth redirectImmediately>
                    <Organization />
                  </RequireAuth>
                }
              />
              {/* Control deck. Deliberately unlinked from the product: no
                  navigation, footer, or marketing surface points here.

                  Its credential system is separate from Nexa accounts — an
                  admin is not a `users` row and cannot be reached through
                  /auth — so none of this is wrapped in RequireAuth. /admin
                  bounces to /admin/login when the stored bearer token is
                  missing, wrong or expired. */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin/setup" element={<AdminSetup />} />
              <Route path="/admin" element={<Admin />} />
              {/* Joining never requires signing in: the room establishes an
                  anonymous session itself. */}
              <Route path="/m/:code" element={<Meeting />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
      </RootErrorBoundary>
    </StrictMode>,
  );
}
