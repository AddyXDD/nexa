import { Reveal, SectionHead } from "./ui";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/* ============================================================== THE PROBLEM */

const RESIDUE: Array<[string, string]> = [
  ["Account information", "An email, a name, a profile"],
  ["Meeting metadata", "Who met, when, for how long"],
  ["Recordings", "The conversation itself, on disk"],
  ["Device identifiers", "Browser and hardware fingerprints"],
  ["Persistent profiles", "A history that accumulates over time"],
  ["Attendance history", "A record of who was where"],
];

/**
 * "Your meeting shouldn't follow you after it ends." — the residue most
 * meeting tools create by default, next to what Nexa actually does. Factual
 * and generalized; no specific competitor is named or implied by name.
 */
export function Problem() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 sm:px-6 lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHead
            eyebrow="The problem"
            title={
              <>
                Your meeting shouldn&apos;t
                <br />
                follow you after it ends.
              </>
            }
          />
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
            Most meeting platforms are built to accumulate: accounts, logs,
            recordings, identifiers. Each one is defensible on its own;
            together they become a trail that outlives the conversation.
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground/80">
            Generalized from how common meeting tools behave by default, not
            a claim about any specific product.
          </p>
        </div>

        {/* residue ledger */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-2 border-b border-border">
            <p className="border-r border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Typical platform · by default
            </p>
            <p className="px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--nexa-accent)]">
              With Nexa
            </p>
          </div>
          <ul>
            {RESIDUE.map(([label, detail], index) => (
              <li
                key={label}
                className="grid grid-cols-2 border-b border-border/60 last:border-b-0"
              >
                <div className="border-r border-border/60 px-5 py-4">
                  <p className="text-sm font-medium text-foreground/90">
                    {label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {detail}
                  </p>
                </div>
                <div className="px-5 py-4">
                  <Reveal delay={index * 0.06}>
                    <span className="inline-flex items-center gap-2 rounded-md border border-[color:var(--nexa-accent)]/35 bg-[color:var(--nexa-accent)]/8 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--nexa-accent)]">
                      {index === 0
                        ? "Email only; guests: none"
                        : index === 1
                          ? "Swept with the room"
                          : index === 2
                            ? "No recording feature"
                            : index === 3
                              ? "Random, never derived"
                              : index === 4
                                ? "No profile to build"
                                : "No history kept"}
                    </span>
                  </Reveal>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ NEXA FORGETS */

const STEPS = ["Join", "Anon ID", "Meet", "Leave", "Disappear"] as const;

/**
 * "Nexa remembers what you need. Not who you are." — the identity flow runs
 * itself when scrolled into view; at DISAPPEAR the minted Nexa ID visibly
 * dissolves. Reduced motion shows the end state directly.
 */
export function Forgets() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState(-1);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      setStage(STEPS.length - 1);
      return;
    }
    let timers: number[] = [];
    setStage(0);
    STEPS.forEach((_, index) => {
      if (index === 0) return;
      timers.push(
        window.setTimeout(() => setStage(index), index * 750),
      );
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [inView, reduceMotion]);

  const forgotten = stage >= STEPS.length - 1;

  return (
    <section id="forgets" className="scroll-mt-24 border-t border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
        <SectionHead
          eyebrow="Nexa forgets"
          title={
            <>
              Nexa remembers what you need.
              <br />
              Not who you are.
            </>
          }
          sub="Everyone in the room sees a random Nexa ID: never your email, never your name, never a profile. When the room closes, the trail is swept away with it."
        />

        <div ref={ref} className="mt-14">
          {/* flow rail */}
          <ol className="grid gap-3 sm:grid-cols-5 sm:gap-0">
            {STEPS.map((step, index) => {
              const active = stage >= index;
              const isLast = index === STEPS.length - 1;
              return (
                <li key={step} className="relative flex items-center gap-3 sm:block">
                  {/* connector (desktop only — no stray line behind mobile labels) */}
                  {index < STEPS.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-[13px] hidden h-px w-full origin-left bg-border sm:block"
                    >
                      <motion.span
                        className="block h-full w-full origin-left bg-[color:var(--nexa-accent)]"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: active && stage > index ? 1 : 0 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </span>
                  ) : null}
                  <span
                    className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] transition-all duration-500 ${
                      active
                        ? isLast
                          ? "border-[color:var(--nexa-accent)] bg-[color:var(--nexa-accent)]/15 text-[color:var(--nexa-accent)]"
                          : "border-[color:var(--nexa-accent)]/60 bg-background text-foreground"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span
                    className={`font-mono text-[11px] uppercase tracking-[0.18em] transition-colors duration-500 sm:mt-3 sm:block ${
                      active ? "text-foreground" : "text-muted-foreground/50"
                    }`}
                  >
                    {step}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* the ID itself */}
          <div className="relative mt-12 flex items-center justify-center">
            <motion.div
              animate={
                forgotten && !reduceMotion
                  ? { opacity: 0, filter: "blur(10px)", scale: 0.94 }
                  : { opacity: 1, filter: "blur(0px)", scale: 1 }
              }
              transition={{ duration: 1.4, ease: [0.4, 0, 0.2, 1] }}
              className="rounded-xl border border-border bg-card px-8 py-6 text-center"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Your identity in the room
              </p>
              <p className="mt-2 font-mono text-3xl tracking-[0.16em] text-foreground sm:text-4xl">
                NX-7F42K9
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Minted on arrival · swept when the room empties
              </p>
            </motion.div>

            <motion.span
              animate={{ opacity: forgotten ? 1 : 0 }}
              transition={{ duration: 0.9, delay: forgotten ? 1.1 : 0 }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-6 rounded-md border border-[color:var(--nexa-accent)]/50 px-4 py-2 font-mono text-sm uppercase tracking-[0.3em] text-[color:var(--nexa-accent)]"
            >
              Forgotten
            </motion.span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================================================ SECURITY */

/** A packet of data travelling a lane, forever (transform-only animation). */
function Packet({ delay = 0 }: { delay?: number }) {
  return (
    <motion.span
      aria-hidden="true"
      className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-[color:var(--nexa-accent)]"
      initial={{ left: "0%", opacity: 0 }}
      animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
      transition={{
        duration: 2.4,
        delay,
        repeat: Infinity,
        ease: "linear",
        repeatDelay: 0.6,
      }}
    />
  );
}

/**
 * "Privacy isn't a setting." — the real architecture, drawn honestly:
 * media flows peer-to-peer with transport encryption (live today),
 * the servers route connection signals only, and application-layer
 * E2EE is labelled as coming soon rather than claimed.
 */
export function Security() {
  return (
    <section id="security" className="scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
        <SectionHead
          eyebrow="Security"
          title="Privacy is the architecture."
          sub="Media travels directly between participants, the servers route connection signals, and everything temporary is swept every minute. Here's the path a conversation actually takes."
        />

        {/* encryption lanes */}
        <Reveal className="mt-12">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {/* media lane */}
            <div className="border-b border-border p-6 sm:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Audio &amp; video, peer to peer
              </p>
              <div className="mt-5 flex items-center gap-3 sm:gap-4">
                <LaneNode label="Your device" />
                <div className="relative h-px flex-1 bg-border">
                  <Packet />
                  <span className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-4 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:block">
                    DTLS-SRTP · encrypted in transit
                  </span>
                </div>
                <LaneNode label="Participant" accent />
              </div>
              <div className="mt-8 flex items-center gap-3 sm:gap-4 sm:pl-10">
                <LaneNode label="Nexa servers" small />
                <span className="relative h-px flex-1 bg-border/60">
                  <span className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-4 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:block">
                    connection signals only, never audio or video
                  </span>
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Routes setup
                </span>
              </div>
            </div>

            {/* honest status */}
            <div className="flex flex-wrap items-center gap-3 p-6 sm:p-8">
              <span className="inline-flex items-center gap-2 rounded-md border border-[color:var(--nexa-accent)]/40 bg-[color:var(--nexa-accent)]/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--nexa-accent)]">
                Transport encryption · live today
              </span>
              <span className="inline-flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-amber-700">
                Application-layer E2EE: coming soon
              </span>
              <p className="basis-full text-xs leading-relaxed text-muted-foreground">
                We don&apos;t market transport encryption as end-to-end
                encryption. The media pipeline is isolated from the UI so
                proper E2EE can be added without a rewrite.
              </p>
            </div>
          </div>
        </Reveal>

        {/* pillars */}
        <div className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Encrypted media in transit",
              body: "WebRTC encrypts audio and video with DTLS-SRTP between participants, keyed by the browsers.",
            },
            {
              title: "Anonymous IDs",
              body: "A CSPRNG-minted Nexa ID per account, server-enforced uniqueness, never derived from personal data.",
            },
            {
              title: "Minimal data retention",
              body: "Meeting state lives only while the room does; a per-minute sweeper deletes the rest.",
            },
            {
              title: "Secure infrastructure",
              body: "WSS/TLS everywhere, identities validated server-side, rate limits on every sensitive call.",
            },
            {
              title: "No unnecessary identity",
              body: "Guests never give a name or email. The server sees which account holds a seat, nothing more.",
            },
            {
              title: "Room-scoped by construction",
              body: "Chat, roster and signals are deleted with the room; there is no archive to breach.",
            },
          ].map((pillar, index) => (
            <Reveal key={pillar.title} delay={(index % 3) * 0.06}>
              <article className="h-full border-t border-border pt-4">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 text-[15px] font-semibold tracking-tight">
                  {pillar.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {pillar.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function LaneNode({
  label,
  accent = false,
  small = false,
}: {
  label: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={`shrink-0 rounded-lg border px-3 py-2 font-mono text-[11px] tracking-wide sm:px-4 ${
        accent
          ? "border-[color:var(--nexa-accent)]/50 bg-[color:var(--nexa-accent)]/10 text-[color:var(--nexa-accent)]"
          : "border-border bg-background text-foreground/80"
      } ${small ? "text-[10px] text-muted-foreground" : ""}`}
    >
      {label}
    </span>
  );
}
