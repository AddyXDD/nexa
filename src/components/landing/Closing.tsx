import { Reveal, SectionHead } from "./ui";
import { NexaLogo, NexaMark } from "@/components/NexaMark";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PLANS } from "@/shared/constants";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

/* ============================================================== BUILT FOR */

const BUILT_FOR: Array<[string, string]> = [
  ["Private conversations", "Things that should never reach a transcript."],
  ["Remote teams", "Daily standups without a permanent record."],
  ["Students", "Tutoring and study groups, no account required."],
  ["Creators", "Calls with editors and collaborators: link in, done."],
  ["Small businesses", "Client conversations that stay between you."],
];

/**
 * Social proof, honestly: Nexa has no public testimonials yet, so instead of
 * fabricating any, this section states who the product is for. Replace with
 * genuine quotes if/when they exist.
 */
export function BuiltFor() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl gap-12 px-5 py-24 sm:px-6">
        <SectionHead
          eyebrow="Built for"
          title="Conversations that shouldn't be archived."
        />
        <ul className="mt-10 border-t border-border">
          {BUILT_FOR.map(([label, detail], index) => (
            <Reveal key={label} delay={index * 0.05}>
              <li className="group flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-border py-6 transition-colors hover:bg-card/50">
                <span className="flex items-baseline gap-5">
                  <span className="font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-[color:var(--nexa-accent)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="inline-block text-2xl font-semibold tracking-[-0.03em] transition-colors group-hover:text-[color:var(--nexa-accent)] sm:text-3xl">
                    {label}
                  </span>
                </span>
                <span className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {detail}
                </span>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ============================================== COMING FROM SOMEWHERE ELSE */

/** Familiar habits, mapped to their Nexa equivalent — all implemented. */
const KNOWN: Array<[string, string]> = [
  [
    "Join with a link",
    "Open it and you're in. No download prompt, no \"get the app\" wall.",
  ],
  [
    "Mute with M, camera with V",
    "The same muscle memory, plus S to share, C for chat, P for people.",
  ],
  [
    "Share your screen",
    "Your browser's own picker; your camera comes back the moment you stop.",
  ],
  [
    "Grid, stage or compact tiles",
    "Three layouts, switchable mid-call and remembered for next time.",
  ],
  [
    "Join before the host",
    "Arrive early, check your mic and camera, and wait inside the room.",
  ],
  [
    "Chat and reactions beside the call",
    "Everyone, or one person privately — both disappear with the room.",
  ],
];

const SKIPPED = [
  "No account, no email, no phone number",
  "Nothing to install, update or uninstall",
  "No plugin, extension or download prompt",
  "No recording, transcript or meeting history",
  "No invite emails to chase — the link is the invite",
];

/**
 * The switcher's section: everything a person arriving from another meeting
 * tool already knows, stated back to them, next to what they can stop
 * worrying about. Reassurance, not comparison — no competitor is named.
 */
export function Familiar() {
  return (
    <section id="familiar" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
        <SectionHead
          eyebrow="Coming from somewhere else"
          title="You already know how to do this."
          sub="The habits you built in whichever tool you use today still work here. What changes is what the room leaves behind afterwards — which is nothing."
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Reveal>
            <ul className="h-full border-t border-border">
              {KNOWN.map(([label, detail]) => (
                <li
                  key={label}
                  className="flex items-start gap-4 border-b border-border py-5"
                >
                  <Check className="mt-0.5 size-4 shrink-0 text-[color:var(--nexa-accent)]" />
                  <div>
                    <p className="text-[15px] font-medium text-foreground">
                      {label}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="flex h-full flex-col rounded-xl border border-[color:var(--nexa-accent)]/40 bg-card p-6 sm:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--nexa-accent)]">
                What you can skip
              </p>
              <ul className="mt-6 space-y-3">
                {SKIPPED.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-sm leading-relaxed text-foreground/90"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-px w-4 shrink-0 bg-[color:var(--nexa-accent)]/60"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-7 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
                Leaving is where you've always found it. When the last person
                walks out, the room deletes itself — chat, roster and signals
                included. Nothing to clean up later.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ================================================================ PRICING */

const PLAN_ROWS = [
  {
    plan: PLANS.free.name,
    price: "₹0",
    cadence: "forever",
    people: "15 participants",
    length: "2 hours",
    blurb: "Stand-ups, quick calls, and small working sessions.",
    cta: "Start a room" as const,
    features: [
      "Up to 15 participants in a room",
      "Meetings run up to 2 hours",
      "Peer-to-peer video, audio, and screen sharing",
      "Temporary room chat, nothing is kept",
      "Guests join from a link, no account needed",
    ],
  },
  {
    plan: PLANS.business.name,
    price: `₹${PLANS.business.pricePaise / 100}`,
    cadence: "/ month",
    people: "100 participants",
    length: "8 hours",
    blurb: "Teams that run longer sessions, larger rooms and shared workspaces.",
    cta: "Sign in to upgrade" as const,
    features: [
      "Up to 100 participants in a room",
      "Meetings run up to 8 hours",
      "Everything in Free",
      `Organizations with ${PLANS.business.organizationSeats} seats`,
      "Role-based membership, invitations and private meetings",
      "One bill per workspace, through Razorpay",
    ],
  },
  {
    plan: PLANS.enterprise.name,
    price: `₹${PLANS.enterprise.pricePaise / 100}`,
    cadence: "/ month",
    people: "Unlimited",
    length: "No limit",
    blurb: "Rooms and workspaces without meeting ceilings.",
    cta: "Create a workspace" as const,
    features: [
      "Unlimited participants",
      "No limit on meeting length",
      "Everything in Business",
      `Organizations with ${PLANS.enterprise.organizationSeats} seats`,
      "Membership and billing modelled per workspace",
    ],
  },
];

/**
 * Pricing preview: clean rows rather than a wall of cards. "Explore plans"
 * expands the full feature lists inline. Plans and limits come from the
 * real `PLANS` constants — nothing here is aspirational.
 */
export function Pricing({
  onStart,
  starting,
}: {
  onStart: () => void;
  starting: boolean;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  return (
    <section id="pricing" className="scroll-mt-24 border-t border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
        <SectionHead
          eyebrow="Pricing"
          title="Free to meet. Paid to grow."
          sub="Every plan includes the full meeting experience. The tiers change how large a room you can open, how long it may run, and — from Business up — how many people can share a workspace."
        />

        {/* header row */}
        <div className="mt-12 hidden grid-cols-[1.4fr_1fr_1fr_1.6fr_auto] gap-4 border-b border-border pb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground lg:grid">
          <span>Plan</span>
          <span>Participants</span>
          <span>Meeting length</span>
          <span>What it is</span>
          <span className="text-right">Get it</span>
        </div>

        <ul>
          {PLAN_ROWS.map((row, index) => {
            const highlighted = index === 1;
            return (
              <Reveal key={row.plan} delay={index * 0.06}>
                <li
                  className={`grid gap-x-4 gap-y-3 border-b border-border py-6 lg:grid-cols-[1.4fr_1fr_1fr_1.6fr_auto] lg:items-center ${highlighted ? "bg-card/60" : ""}`}
                >
                  <div>
                    <span className="flex items-center gap-2.5">
                      <span className="text-lg font-semibold tracking-tight">
                        {row.plan}
                      </span>
                      {highlighted ? (
                        <span className="rounded-full bg-[color:var(--nexa-accent)]/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-[color:var(--nexa-accent)]">
                          Popular
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-2xl font-semibold tracking-tight tabular-nums">
                      {row.price}
                      {row.cadence ? (
                        <span className="ml-1 text-sm font-normal text-muted-foreground">
                          {row.cadence}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <span className="font-mono text-sm text-foreground/85">
                    {row.people}
                  </span>
                  <span className="font-mono text-sm text-foreground/85">
                    {row.length}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {row.blurb}
                  </span>
                  <div className="lg:text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (row.cta === "Start a room") onStart();
                        else if (row.cta === "Sign in to upgrade")
                          navigate("/auth?returnTo=%2Fdashboard");
                        else
                          navigate(
                            `/auth?returnTo=${encodeURIComponent("/org/new")}`,
                          );
                      }}
                      disabled={starting && row.cta === "Start a room"}
                      className={`inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-5 text-sm font-medium transition-colors disabled:opacity-60 lg:w-auto ${highlighted ? "bg-foreground text-background hover:opacity-90" : "border border-border bg-card/70 text-foreground hover:bg-muted"}`}
                    >
                      {row.cta === "Start a room" && starting ? (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Opening…
                        </>
                      ) : (
                        row.cta
                      )}
                    </button>
                  </div>
                </li>
              </Reveal>
            );
          })}
        </ul>

        {/* explore plans */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="group inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? "Hide plan details" : "Explore plans"}
          </button>
          <p className="text-xs text-muted-foreground">
            Business checkout runs through Razorpay; card data never touches
            Nexa.
          </p>
        </div>

        {expanded && (
          <div className="mt-6 grid gap-4">
            {PLAN_ROWS.map((row, rowIndex) => (
              <div
                key={row.plan}
                className="rounded-xl border border-border bg-card p-5"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {String(rowIndex + 1).padStart(2, "0")} · {row.plan}
                </p>
                <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  {row.features.map((feature) => (
                    <li key={feature} className="leading-relaxed">
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ===================================================================== FAQ */

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "What is Nexa?",
    a: "Nexa is a browser-based video meeting platform built around a simple rule: a conversation shouldn't outlive itself. Temporary rooms, anonymous identities, and no meeting history; the meeting experience is what you'd expect from a modern tool.",
  },
  {
    q: "How does anonymous identity work?",
    a: "When you enter a room, the server mints a random Nexa ID from a cryptographically secure random source; it is never derived from your email, name, or anything else personal. It's the only identity other participants see, plus the display name you choose (or none at all).",
  },
  {
    q: "Does Nexa store my meetings?",
    a: "No. Audio and video never reach our servers at all; they travel peer to peer. Signalling, chat and roster exist only while the room is open; when the last person leaves, a sweeper deletes them, and the room row itself follows minutes later. Account emails and payment records persist, because sign-in and billing require them, as does one anonymous number: how many rooms have been opened in total, with no code, person, or date attached to it.",
  },
  {
    q: "Is Nexa end-to-end encrypted?",
    a: "Media is encrypted in transit with DTLS-SRTP by your browsers and flows directly between participants, so the servers never see it. Application-layer end-to-end encryption is not implemented yet, and we don't claim otherwise; the media pipeline is isolated from the UI so it can be added without a rewrite.",
  },
  {
    q: "Can I join without an account?",
    a: "Yes. Opening a meeting link establishes a silent anonymous session and mints a Nexa ID on arrival. Only the dashboard and billing require a real sign-in.",
  },
  {
    q: "What happens if my internet is slow?",
    a: "The call adapts instead of stopping: WebRTC congestion control steps bitrate down, background effects reduce their processing load, and the interface shows reconnecting while peers recover or rebuild. Quality returns when the network does.",
  },
  {
    q: "Can I join before the host?",
    a: "Yes. Open the link early, allow camera and microphone in the pre-join screen, and wait in the room. Your seat is only taken once you actually join.",
  },
  {
    q: "Is Nexa free?",
    a: "Yes. The Free plan covers rooms of up to 15 participants and meetings up to 2 hours with the full feature set. Business (₹299/month) raises the caps to 100 participants and 8 hours and adds organizations with 25-seat workspaces. Enterprise (₹799/month) removes the participant and time ceilings and includes 100 workspace seats. Each paid period is 30 days and renews when you pay again. The meeting clock starts when the first seat is taken.",
  },
  {
    q: "When I run the Windows app, Windows shows a warning — what do I do?",
    a: "Nexa Meet isn&rsquo;t signed with a code-signing certificate yet, so Windows Defender SmartScreen shows a blue &ldquo;Windows protected your PC&rdquo; prompt the first time you run the .exe. Click &ldquo;More info&rdquo; in that window, then click &ldquo;Run anyway&rdquo;. If the button doesn&rsquo;t appear immediately, wait a few seconds; SmartScreen takes a moment to surface the full prompt on first run.",
  },
  {
    q: "Is it safe to run the app if Windows warns me about it?",
    a: "The warning is about the app not being signed, not about the app being known-malicious. To be sure you have the real file and not a copy someone sent you, always run the version you downloaded yourself from the Download app button, and preferably compare its SHA-256 against a hash listed on a release you trust.",
  },
  {
    q: "Is Nexa open source?",
    a: "The codebase isn't published as open source at the moment. The privacy claims on this page are structural rather than promises: media is peer-to-peer, temporary meeting state is deleted by an automated sweeper, and there is no recording feature at all.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-24 sm:px-6 lg:grid-cols-[4fr_8fr] lg:gap-16">
        <div>
          <SectionHead eyebrow="FAQ" title="Straight answers." />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-muted-foreground">
            If a question isn&apos;t answered here, the privacy section above
            describes exactly what happens to a room&apos;s data.
          </p>
        </div>
        <Accordion type="single" collapsible className="border-t border-border">
          {FAQS.map((item) => (
            <AccordionItem
              key={item.q}
              value={item.q}
              className="border-border"
            >
              <AccordionTrigger className="rounded-none py-5 text-base hover:no-underline">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

/* ============================================================== FINAL CTA */

/**
 * The closing statement — poster composition (rules, corner labels,
 * oversized type) rather than a repeat of the hero's two-column layout.
 */
export function FinalCta({
  onStart,
  starting,
}: {
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <section className="relative overflow-hidden border-y border-border bg-card/40">
      {/* corner labels */}
      <div className="relative mx-auto flex max-w-6xl items-center justify-between border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground sm:px-6">
        <span>Nexa</span>
        <span className="hidden sm:inline">Meet. Then disappear.</span>
        <span>End</span>
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 text-center sm:px-6 sm:py-28">
        <Reveal>
          <NexaMark className="mx-auto size-11" />
          <h2 className="mx-auto mt-8 max-w-4xl text-[clamp(2.5rem,6.5vw,4.75rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
            Meet without leaving{" "}
            <span className="italic">a trail.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
            Start your next conversation with Nexa.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="inline-flex h-13 items-center gap-2 rounded-lg bg-foreground px-8 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-60"
            >
              {starting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Opening a room…
                </>
              ) : (
                <>Start a meeting</>
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("forgets")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              className="inline-flex h-13 items-center rounded-lg border border-border bg-card px-8 text-sm font-medium transition-colors hover:bg-muted"
            >
              Learn about privacy
            </button>
          </div>
        </Reveal>
      </div>

      <div className="mx-auto flex max-w-6xl items-center justify-between border-t border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground sm:px-6">
        <span>05 / Close</span>
        <span className="hidden sm:inline">Nexa forgets</span>
        <span className="text-[color:var(--nexa-accent)]">No history</span>
      </div>
    </section>
  );
}

/* ================================================================= FOOTER */

/**
 * The footer is where the crawlable internal links live: the legal and
 * account entries are real anchors so `/terms` and `/privacy` are reachable
 * by following links (they used to be buttons — the only path to them was
 * the sitemap). The section entries stay buttons because they scroll the
 * current page rather than navigate.
 */
export function SiteFooter({
  onNavigate,
}: {
  onNavigate: (id: string) => void;
}) {
  return (
    <footer>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <NexaLogo markClassName="size-6" />
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Privacy-first meetings for people who&apos;d rather not be a
            dataset. Meet. Then disappear.
          </p>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
            Nexa forgets
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Product
            </p>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("experience")}
                  className="hover:text-foreground"
                >
                  Meeting experience
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("demo")}
                  className="hover:text-foreground"
                >
                  Interactive demo
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("pricing")}
                  className="hover:text-foreground"
                >
                  Pricing
                </button>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Trust
            </p>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("forgets")}
                  className="hover:text-foreground"
                >
                  Privacy model
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("security")}
                  className="hover:text-foreground"
                >
                  Security
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("faq")}
                  className="hover:text-foreground"
                >
                  FAQ
                </button>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Account
            </p>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              <li>
                <Link
                  to="/auth?returnTo=%2Fdashboard"
                  className="hover:text-foreground"
                >
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="hover:text-foreground">
                  Dashboard
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Legal
            </p>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              <li>
                <Link to="/terms" className="hover:text-foreground">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-foreground">
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © 2026 Nexa. Media is encrypted in transit by WebRTC; Nexa does not
            record meetings and does not keep meeting history.
          </p>
          <nav
            aria-label="Legal"
            className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.16em]"
          >
            <Link
              to="/privacy"
              className="text-foreground underline underline-offset-4 transition-colors hover:text-foreground/70"
            >
              Privacy Policy
            </Link>
            <Link to="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
