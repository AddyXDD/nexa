import { NexaLogo } from "@/components/NexaMark";
import { SUPPORT_EMAIL } from "@/shared/constants";
import { Link } from "react-router";

/**
 * Shared shell for the legal pages: the landing's paper theme, a plain
 * editorial column, numbered sections. No animation, no cards, no ornament.
 */
export function LegalPage({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nexa-landing min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 sm:px-6">
          <Link to="/" aria-label="Nexa home">
            <NexaLogo markClassName="size-6" />
          </Link>
          <Link
            to="/"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
          Last updated {updated}
        </p>

        <div className="mt-10 space-y-10">{children}</div>
      </main>

      <footer className="border-t border-border">
        <p className="mx-auto max-w-3xl px-5 py-6 text-xs leading-relaxed text-muted-foreground sm:px-6">
          © 2026 Nexa. Questions about this document can be sent to{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </footer>
    </div>
  );
}

export function LegalSection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="flex items-baseline gap-3 text-xl font-semibold tracking-[-0.02em]">
        <span className="font-mono text-[11px] font-normal text-muted-foreground">
          {String(n).padStart(2, "0")}
        </span>
        {title}
      </h2>
      <div className="mt-3.5 space-y-3.5 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
