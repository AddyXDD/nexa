import { Reveal, SectionHead } from "./ui";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/* ====================================================== MEETING EXPERIENCE */

const EXPERIENCE: Array<{ title: string; body: string; demo: React.ReactNode }> = [
  {
    title: "HD video",
    body: "Up to 1080p where the connection allows it, negotiated by the browser.",
    demo: <Chip>1080P</Chip>,
  },
  {
    title: "Adaptive video quality",
    body: "Bitrate is negotiated continuously, so quality flexes before the call does.",
    demo: <Chip tone="jade">AUTO</Chip>,
  },
  {
    title: "Automatic quality reduction",
    body: "On a weak network the picture steps down on its own. No buffering spinner.",
    demo: <Chip tone="amber">480P · STEPPED DOWN</Chip>,
  },
  {
    title: "Screen sharing",
    body: "The browser's own picker, one click, and your camera returns when you stop.",
    demo: <StageGlyph />,
  },
  {
    title: "Noise cancellation",
    body: "Three honest tiers (Off, Standard, Strong) mapped to real browser processing.",
    demo: (
      <span className="inline-flex rounded-lg border border-border bg-muted p-1">
        {["Off", "Standard", "Strong"].map((tier) => (
          <span
            key={tier}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              tier === "Standard"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            {tier}
          </span>
        ))}
      </span>
    ),
  },
  {
    title: "Background blur & effects",
    body: "Blur, virtual backgrounds and image adjustments that never renegotiate the call.",
    demo: (
      <span className="flex items-center gap-2">
        <span className="relative block h-8 w-14 overflow-hidden rounded-md border border-border bg-muted">
          <span className="absolute left-1/2 top-1 size-3 -translate-x-1/2 rounded-full bg-muted-foreground/50 blur-[2px]" />
          <span className="absolute bottom-0 left-1/2 h-4 w-7 -translate-x-1/2 rounded-t-full bg-muted-foreground/40 blur-[3px]" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          blurred
        </span>
      </span>
    ),
  },
  {
    title: "Participant management",
    body: "Host controls, live roster, mic and camera states: per seat, instantly.",
    demo: (
      <span className="flex -space-x-1.5">
        {["PR", "3B", "MA"].map((initials) => (
          <span
            key={initials}
            className="flex size-7 items-center justify-center rounded-full border border-border bg-muted font-mono text-[9px] text-muted-foreground"
          >
            {initials}
          </span>
        ))}
      </span>
    ),
  },
  {
    title: "Join before host",
    body: "Open the room early, warm up your mic and camera, wait without awkwardness.",
    demo: <Chip tone="amber">HOST HASN'T JOINED</Chip>,
  },
  {
    title: "Meeting notifications",
    body: "A quiet toast when someone joins or leaves. Never a persistent history.",
    demo: (
      <span className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <span className="size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
        <span className="font-mono text-[10px] text-muted-foreground">
          NX-3B8TQM joined
        </span>
      </span>
    ),
  },
  {
    title: "Modern controls",
    body: "A floating control system with contextual menus; nothing buried three clicks deep.",
    demo: (
      <span className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`size-5 rounded ${
              i === 1
                ? "bg-[color:var(--nexa-accent)]/25"
                : "bg-muted"
            }`}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="size-5 rounded bg-[color:var(--destructive)]/25" />
      </span>
    ),
  },
  {
    title: "Responsive interface",
    body: "Stage, grid or compact strip; the room re-lays-out for the screen it's on.",
    demo: <LayoutGlyph />,
  },
];

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "jade" | "amber";
}) {
  return (
    <span
      className={`inline-flex rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
        tone === "jade"
          ? "border-[color:var(--nexa-accent)]/40 bg-[color:var(--nexa-accent)]/10 text-[color:var(--nexa-accent)]"
          : tone === "amber"
            ? "border-amber-500/50 bg-amber-500/15 text-amber-700"
            : "border-border bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function StageGlyph() {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-8 w-14 rounded-md border border-[color:var(--nexa-accent)]/40 bg-[color:var(--nexa-accent)]/10" />
      <span className="flex flex-col gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-2 w-6 rounded-sm bg-muted" />
        ))}
      </span>
    </span>
  );
}

function LayoutGlyph() {
  return (
    <span className="flex items-end gap-1">
      <span className="h-8 w-10 rounded-md bg-muted" />
      <span className="flex flex-col gap-1">
        <span className="block h-3.5 w-10 rounded-sm bg-muted" />
        <span className="block h-3.5 w-10 rounded-sm bg-muted" />
      </span>
    </span>
  );
}

/**
 * "Private shouldn't mean primitive." — an editorial capability list rather
 * than a card wall: each row pairs a plain-language claim with a tiny live
 * demonstration of the real interface language.
 */
export function Experience() {
  return (
    <section id="experience" className="scroll-mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 sm:px-6 lg:grid-cols-[4fr_8fr] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHead
            eyebrow="The meeting experience"
            title={
              <>
                Private shouldn&apos;t
                <br />
                mean primitive.
              </>
            }
          />
          <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">
            The privacy model lives in the architecture, not in missing
            features. Everything you expect from a modern meeting room is
            here, and it stays out of the conversation&apos;s way.
          </p>
        </div>

        <ul className="border-t border-border">
          {EXPERIENCE.map((item, index) => (
            <Reveal key={item.title} delay={Math.min(index, 5) * 0.04}>
              <li className="group grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-1 border-b border-border py-4 transition-colors hover:bg-card/60 sm:grid-cols-[auto_1fr_auto]">
                <span className="font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-[color:var(--nexa-accent)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-[15px] font-medium tracking-tight text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-0.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
                <div className="col-span-2 flex justify-start pt-1 sm:col-span-1 sm:justify-end sm:pt-0">
                  {item.demo}
                </div>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ==================================================== ADAPTIVE CONNECTION */

const STAGES = [
  { label: "Good connection", quality: "1080p" },
  { label: "Network drops", quality: "720p" },
  { label: "Network drops", quality: "480p" },
];

/**
 * The adaptive-quality demonstration: the quality ladder cycles downward the
 * way a real congestion controller would, while the connection line and the
 * "connected" indicator never break. Reduced motion freezes the sequence.
 */
export function Adaptive() {
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(
      () => setStage((current) => (current + 1) % STAGES.length),
      2400,
    );
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  const logLines = [
    { t: "00:12", text: "congestion detected, stepping to 720p", tone: "amber" },
    { t: "00:19", text: "still dropping, stepping to 480p", tone: "amber" },
    { t: "00:26", text: "no packets lost · call alive", tone: "jade" },
  ];

  return (
    <section className="border-t border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
        <SectionHead
          eyebrow="Adaptive connection"
          title="The conversation stays alive."
          sub="Nexa prioritises keeping the call up over stubbornly maintaining resolution. When the network tightens, the picture gives; the conversation doesn't."
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          {/* quality ladder */}
          <Reveal>
            <div className="h-full rounded-xl border border-border bg-card p-6 sm:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Simulated congestion
              </p>
              <ol className="mt-6 space-y-0">
                {STAGES.map((s, index) => {
                  const active = stage === index;
                  return (
                    <li key={s.quality}>
                      <div
                        className={`flex items-center justify-between rounded-lg border px-5 py-4 transition-all duration-500 ${
                          active
                            ? "border-[color:var(--nexa-accent)]/60 bg-[color:var(--nexa-accent)]/8"
                            : "border-border bg-background/40 opacity-60"
                        }`}
                      >
                        <span className="text-sm font-medium text-foreground">
                          {s.label}
                        </span>
                        <span
                          className={`font-mono text-2xl tracking-tight tabular-nums sm:text-3xl ${
                            active
                              ? "text-[color:var(--nexa-accent)]"
                              : "text-muted-foreground"
                          }`}
                        >
                          {s.quality}
                        </span>
                      </div>
                      {index < STAGES.length - 1 ? (
                        <div className="flex items-center gap-2.5 py-1.5 pl-5">
                          <span
                            className={`flex size-5 items-center justify-center rounded-full border text-[10px] transition-colors ${
                              stage > index
                                ? "border-[color:var(--nexa-accent)]/60 text-[color:var(--nexa-accent)]"
                                : "border-border text-muted-foreground"
                            }`}
                          >
                            ↓
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            network drops
                          </span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-5 rounded-lg border border-[color:var(--nexa-accent)]/30 bg-[color:var(--nexa-accent)]/8 px-4 py-3 text-sm font-medium text-[color:var(--nexa-accent)]">
                The meeting stays connected.
              </p>
            </div>
          </Reveal>

          {/* graph + log */}
          <Reveal delay={0.06}>
            <div className="flex h-full flex-col rounded-xl border border-border bg-card p-6 sm:p-8">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Bitrate over time
                </p>
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--nexa-accent)]">
                  <span className="size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
                  Connected
                </span>
              </div>

              {/* the line: dips, recovers lower, never breaks */}
              <svg
                viewBox="0 0 400 140"
                className="mt-5 w-full flex-1"
                role="img"
                aria-label="Bitrate graph that steps down twice and stays connected"
              >
                {[30, 70, 110].map((y, i) => (
                  <g key={y}>
                    <line
                      x1="0"
                      y1={y}
                      x2="400"
                      y2={y}
                      stroke="currentColor"
                      className="text-border"
                      strokeDasharray="3 5"
                    />
                    <text
                      x="4"
                      y={y - 5}
                      className="fill-muted-foreground"
                      style={{ fontSize: 8, fontFamily: "monospace" }}
                    >
                      {["1080p", "720p", "480p"][i]}
                    </text>
                  </g>
                ))}
                <motion.path
                  d="M0,30 L70,30 C90,30 95,66 115,70 L210,70 C230,70 235,106 255,110 L400,110"
                  fill="none"
                  stroke="var(--nexa-accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  whileInView={{ pathLength: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.6, ease: "easeInOut" }}
                />
              </svg>

              <ul className="mt-5 space-y-2">
                {logLines.map((line, index) => (
                  <motion.li
                    key={line.text}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 1.6 + index * 0.5, duration: 0.4 }}
                    className="flex items-center gap-3 font-mono text-[11px]"
                  >
                    <span className="text-muted-foreground/70">{line.t}</span>
                    <span
                      className={
                        line.tone === "jade"
                          ? "text-[color:var(--nexa-accent)]"
                          : "text-muted-foreground"
                      }
                    >
                      {line.text}
                    </span>
                  </motion.li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Visualisation of how WebRTC congestion control behaves; the meeting
          interface itself is live in the demo below.
        </p>
      </div>
    </section>
  );
}

/* ====================================================== FEATURE SHOWCASE */

type Feature = { title: string; body: string; visual: React.ReactNode };

const FEATURES: Feature[] = [
  {
    title: "Anonymous identity",
    body: "A random Nexa ID on arrival. No email, no name, no profile: participants see only what you choose to show.",
    visual: (
      <div className="flex flex-col items-center gap-2">
        {["NX-7F42K9", "NX-3B8TQM", "NX-K5WD2R"].map((id, i) => (
          <span
            key={id}
            className="rounded-md border border-border bg-background px-4 py-2 font-mono text-sm tracking-[0.16em] text-foreground/80"
            style={{ opacity: 1 - i * 0.25 }}
          >
            {id}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Privacy-first meetings",
    body: "Chat, roster and signals are deleted with the room. There is no meeting history to search, subpoena, or leak.",
    visual: (
      <div className="space-y-2 font-mono text-[11px] text-muted-foreground">
        {["chatMessages", "participants", "signals"].map((table) => (
          <div
            key={table}
            className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
          >
            <span>{table}</span>
            <span className="text-[color:var(--nexa-accent)]">deleted on exit</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Adaptive video",
    body: "Resolution steps down with the network and back up when it recovers; the call never blinks.",
    visual: (
      <div className="flex items-end gap-2">
        {["1080", "720", "480"].map((q, i) => (
          <span
            key={q}
            className="flex items-end justify-center rounded-md border border-border bg-background px-3 pb-2 pt-6 font-mono text-xs text-muted-foreground"
            style={{ height: 74 - i * 16 }}
          >
            {q}p
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Noise cancellation",
    body: "Keyboards, fans and AC filtered out at three honest tiers, mapped to real browser processing, not marketing.",
    visual: (
      <div className="w-full space-y-3">
        <div className="flex h-8 items-center gap-[2px]">
          {Array.from({ length: 30 }, (_, i) => (
            <span
              key={i}
              className="w-1 rounded-sm bg-muted-foreground/50"
              style={{ height: `${8 + ((i * 37) % 24)}px` }}
            />
          ))}
        </div>
        <div className="flex h-8 items-center gap-[2px]">
          {Array.from({ length: 30 }, (_, i) => (
            <span
              key={i}
              className="w-1 rounded-sm bg-[color:var(--nexa-accent)]"
              style={{ height: `${6 + ((i * 13) % 16)}px` }}
            />
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "Background effects",
    body: "Blur and virtual backgrounds run on canvas and swap through the existing track, with no renegotiation, ever.",
    visual: (
      <div className="relative h-28 w-full overflow-hidden rounded-lg border border-border bg-muted">
        <div className="absolute inset-0 bg-gradient-to-b from-muted-foreground/25 to-muted/60 blur-[6px]" />
        <div className="absolute left-1/2 top-4 size-9 -translate-x-1/2 rounded-full bg-muted-foreground/45 blur-[4px]" />
        <div className="absolute bottom-0 left-1/2 h-12 w-16 -translate-x-1/2 rounded-t-full bg-muted-foreground/35 blur-[6px]" />
        <span className="absolute bottom-2 left-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          blurred
        </span>
      </div>
    ),
  },
  {
    title: "Screen sharing",
    body: "Content takes the stage, participants slide into a strip, and your camera comes back when you stop.",
    visual: (
      <div className="flex h-28 w-full flex-col gap-2">
        <div className="flex flex-1 items-center justify-center rounded-lg border border-[color:var(--nexa-accent)]/40 bg-[color:var(--nexa-accent)]/8 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--nexa-accent)]">
          stage
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-7 rounded-md bg-muted" />
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "Join before host",
    body: "Open the link early, test your mic and camera, and wait in a room that already feels ready.",
    visual: (
      <div className="flex h-28 w-full flex-col items-center justify-center gap-3 rounded-lg border border-border bg-background">
        <span className="nexa-pulse size-2.5 rounded-full bg-[color:var(--nexa-accent)]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          waiting for host
        </span>
      </div>
    ),
  },
  {
    title: "Meeting notifications",
    body: "A single quiet toast when someone arrives or leaves: shown, never stored.",
    visual: (
      <div className="flex h-28 w-full items-center justify-center rounded-lg border border-border bg-background">
        <span className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5">
          <span className="size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
          <span className="font-mono text-[11px] text-foreground/80">
            NX-3B8TQM joined
          </span>
        </span>
      </div>
    ),
  },
  {
    title: "Modern meeting controls",
    body: "A floating control slab with contextual menus for camera, microphone and effects; keyboard-first, always reachable.",
    visual: (
      <div className="flex h-28 w-full items-center justify-center rounded-lg border border-border bg-background">
        <span className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`flex size-7 items-center justify-center rounded-md border text-[10px] ${
                i === 2
                  ? "border-[color:var(--nexa-accent)]/50 bg-[color:var(--nexa-accent)]/10 text-[color:var(--nexa-accent)]"
                  : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {["M", "V", "S", "R", "#"][i]}
            </span>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <span className="flex size-7 items-center justify-center rounded-md border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 text-[10px] text-[color:var(--destructive)]">
            ✕
          </span>
        </span>
      </div>
    ),
  },
];

/**
 * The horizontal feature showcase: one large treatment per feature with a
 * real visual demonstration, driven by native scroll (snap + arrows +
 * keyboard) so it behaves everywhere without scroll-jacking.
 */
export function Features() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  const scrollByCard = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>("[data-card]");
    const amount = card ? card.offsetWidth + 16 : 360;
    track.scrollBy({ left: direction * amount, behavior: "smooth" });
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    setProgress(max > 0 ? track.scrollLeft / max : 0);
  };

  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-5 pt-24 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead
            eyebrow="Features"
            title="Everything in the room."
            sub="Nine things Nexa does properly instead of twelve it pretends to."
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous features"
              onClick={() => scrollByCard(-1)}
              className="flex size-10 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-[color:var(--nexa-accent)]/60 hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next features"
              onClick={() => scrollByCard(1)}
              className="flex size-10 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-[color:var(--nexa-accent)]/60 hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={trackRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Feature showcase, scrollable"
        className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-6 sm:px-6 [scrollbar-width:none] lg:px-[max(1.5rem,calc((100vw_-_72rem)_/_2))] [&::-webkit-scrollbar]:hidden"
      >
        {FEATURES.map((feature, index) => (
          <article
            key={feature.title}
            data-card
            className="group w-[84vw] shrink-0 snap-start rounded-xl border border-border bg-card p-6 hover:border-[color:var(--nexa-accent)]/40 sm:w-[400px]"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground transition-colors group-hover:text-[color:var(--nexa-accent)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                {String(index + 1).padStart(2, "0")} / 09
              </span>
            </div>
            <div className="mt-5 flex h-32 items-center justify-center rounded-lg border border-border bg-background/50">
              {feature.visual}
            </div>
            <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">
              {feature.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {feature.body}
            </p>
          </article>
        ))}
      </div>

      {/* progress hairline */}
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="h-px w-full bg-border">
          <div
            className="h-px origin-left bg-[color:var(--nexa-accent)] transition-transform duration-150"
            style={{ transform: `scaleX(${Math.max(0.06, progress)})` }}
          />
        </div>
      </div>
    </section>
  );
}

/* ======================================================= BUILT DIFFERENTLY */

/**
 * "Built differently." — a comparison of design philosophies, stated
 * factually. No competitor names, no security claims about anyone else.
 */
export function BuiltDifferent() {
  return (
    <section className="border-t border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
        <SectionHead
          eyebrow="Positioning"
          title="Built differently."
          sub="Not another reskin of the same meeting flow. Nexa starts from a different assumption about what a conversation should leave behind."
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-xl border border-border bg-card/60 p-6 sm:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                The default arc
              </p>
              <ol className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-3">
                {["Account", "Meeting", "Data", "History"].map((step, i, arr) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="rounded-md border border-border bg-background px-3.5 py-2 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      {step}
                    </span>
                    {i < arr.length - 1 ? (
                      <span className="text-muted-foreground/50">→</span>
                    ) : null}
                  </li>
                ))}
              </ol>
              <p className="mt-7 max-w-md text-sm leading-relaxed text-muted-foreground">
                Identity goes in, and something permanent comes out. This is
                how most meeting tools are shaped by default: the model
                itself, not a judgement of any specific product.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="relative h-full overflow-hidden rounded-xl border border-[color:var(--nexa-accent)]/40 bg-card p-6 sm:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--nexa-accent)]">
                The Nexa arc
              </p>
              <ol className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-3">
                {["Join", "Meet", "Leave"].map((step, i, arr) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="rounded-md border border-[color:var(--nexa-accent)]/40 bg-[color:var(--nexa-accent)]/10 px-3.5 py-2 font-mono text-xs uppercase tracking-[0.12em] text-[color:var(--nexa-accent)]">
                      {step}
                    </span>
                    {i < arr.length - 1 ? (
                      <span className="text-muted-foreground/50">→</span>
                    ) : null}
                  </li>
                ))}
                <li className="ml-1 font-mono text-xs text-muted-foreground">
                  · nothing after
                </li>
              </ol>
              <p className="mt-7 max-w-md text-sm leading-relaxed text-muted-foreground">
                A link, a conversation, and an exit. When the last person
                leaves, the room and everything inside it are deleted; there
                is no fourth step.
              </p>
              <div
                aria-hidden="true"
                className="nexa-grain absolute inset-x-0 bottom-0 h-24 opacity-40"
              />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
