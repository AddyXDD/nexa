import { Loader2 } from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  MEETING_CODE_REGEX,
  formatMeetingCode,
  parseMeetingCodeInput,
} from "@/shared/constants";
import { MeetingWindow } from "./MeetingWindow";

const HEADLINE: Array<{ words: string[]; accent?: boolean }> = [
  { words: ["Meet."] },
  { words: ["Then", "disappear."], accent: true },
];

/**
 * The hero: a kinetic headline (word-by-word entrance, a hand-drawn underline
 * that sketches itself under "disappear."), support copy next to the
 * interactive meeting window, which breaks the container edge, tilts with the
 * pointer and drifts on scroll under two bobbing annotation chips. Motion is
 * entrance/scroll-driven only and disabled for reduced motion.
 */
export function Hero({
  onStart,
  starting,
}: {
  onStart: () => void;
  starting: boolean;
}) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const winRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  // gentle scroll parallax on the product column (sprung, so it settles)
  const { scrollYProgress } = useScroll({
    target: colRef,
    offset: ["start end", "end start"],
  });
  const driftRaw = useTransform(scrollYProgress, [0, 1], [30, -44]);
  const drift = useSpring(driftRaw, {
    stiffness: 110,
    damping: 26,
    mass: 0.5,
  });

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (reduceMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const node = winRef.current;
      if (!node) return;
      node.style.transform = `perspective(1500px) rotateX(${(-y * 2).toFixed(2)}deg) rotateY(${(x * 2.4).toFixed(2)}deg) translate3d(${(x * 8).toFixed(1)}px, ${(y * 5).toFixed(1)}px, 0)`;
    });
  };

  const resetTilt = () => {
    cancelAnimationFrame(frame.current);
    if (winRef.current) winRef.current.style.transform = "";
  };

  const handleJoin = (event: React.FormEvent) => {
    event.preventDefault();
    const code = parseMeetingCodeInput(joinCode);
    if (!MEETING_CODE_REGEX.test(code)) {
      setJoinError(
        "That doesn't look like a meeting code. Codes are 16 characters, like 7K2M-9QX4-TRBD-1HYN.",
      );
      return;
    }
    setJoinError(null);
    navigate(`/m/${formatMeetingCode(code)}`);
  };

  return (
    <section className="relative">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-16 pt-32 sm:px-6 sm:pt-40 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10 lg:pb-24">
        {/* ------------------------------------------------------- copy col */}
        <div>
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground"
          >
            <span className="nexa-pulse size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
            Public Beta
          </motion.span>

          <h1 className="mt-7 text-[clamp(2.75rem,7vw,5.25rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
            {HEADLINE.map((line, lineIndex) => (
              <span key={lineIndex} className="block">
                {line.words.map((word, wordIndex) => {
                  const isUnderlined = word === "disappear.";
                  const wordNode = (
                    <span
                      className={
                        line.accent ? "text-[color:var(--nexa-accent)]" : ""
                      }
                    >
                      {word}
                    </span>
                  );
                  return (
                    <motion.span
                      key={word}
                      initial={{ opacity: 0, y: 26, filter: "blur(6px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      transition={{
                        duration: 0.55,
                        delay: 0.12 + lineIndex * 0.14 + wordIndex * 0.12,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="mr-[0.26em] inline-block last:mr-0"
                    >
                      {isUnderlined ? (
                        <span className="relative inline-block">
                          {wordNode}
                          {/* self-drawing underline */}
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 200 10"
                            preserveAspectRatio="none"
                            fill="none"
                            className="absolute -bottom-2 left-0 h-2.5 w-full overflow-visible"
                          >
                            <motion.path
                              d="M2 7 C 46 1.5, 92 9, 132 4.5 S 182 3, 198 6.5"
                              stroke="var(--nexa-accent)"
                              strokeWidth="3.5"
                              strokeLinecap="round"
                              initial={{ pathLength: 0, opacity: 0 }}
                              animate={{ pathLength: 1, opacity: 1 }}
                              transition={{
                                duration: 0.9,
                                delay: 0.8,
                                ease: "easeInOut",
                              }}
                            />
                          </svg>
                        </span>
                      ) : (
                        wordNode
                      )}
                    </motion.span>
                  );
                })}
              </span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-7 max-w-md text-lg leading-relaxed text-muted-foreground sm:text-xl"
          >
            Nexa is a privacy-first video meeting platform built to keep your
            conversations yours.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="inline-flex h-12 items-center rounded-md bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {starting ? "Opening a room…" : "Start a meeting"}
            </button>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("experience")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              className="inline-flex h-12 items-center rounded-md border border-border bg-card px-6 text-sm font-medium transition-colors hover:bg-muted"
            >
              See how Nexa works
            </button>
          </motion.div>

          {/* invite code */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.72 }}
            className="mt-6"
          >
            <button
              type="button"
              onClick={() => setJoinOpen((open) => !open)}
              className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
            >
              {joinOpen ? "Close" : "Have an invite code?"}
            </button>
            {joinOpen && (
              <form
                onSubmit={handleJoin}
                className="relative mt-3 flex max-w-md gap-2"
              >
                <input
                  autoFocus
                  value={joinCode}
                  onChange={(event) => {
                    setJoinCode(event.target.value);
                    setJoinError(null);
                  }}
                  placeholder="Paste a link or 16-character code"
                  aria-label="Meeting code or link"
                  className="h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3 font-mono text-sm text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  className="inline-flex h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  Join
                </button>
                {joinError && (
                  <p className="absolute left-0 top-full mt-1.5 text-xs text-[color:var(--destructive)]">
                    {joinError}
                  </p>
                )}
              </form>
            )}
          </motion.div>

          <ul className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {["No install", "Guests join free", "Nothing recorded"].map(
              (fact, index) => (
                <motion.li
                  key={fact}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.85 + index * 0.1 }}
                >
                  {fact}
                </motion.li>
              ),
            )}
          </ul>
        </div>

        {/* -------------------------------------------------- product column */}
        <motion.div
          ref={colRef}
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          onMouseMove={handleMouseMove}
          onMouseLeave={resetTilt}
          className="relative lg:-mr-16 xl:-mr-28"
        >
          <motion.div
            style={reduceMotion ? undefined : { y: drift }}
            className="relative"
          >
            <div
              ref={winRef}
              className="will-change-transform transition-transform duration-500 ease-out"
            >
              <MeetingWindow />
            </div>

            {/* bobbing annotation chips */}
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1.05 }}
              className="nexa-bob pointer-events-none absolute -left-5 top-10 z-20 hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground lg:flex"
            >
              <span className="size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
              Peer-to-peer media
            </motion.span>
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1.25 }}
              className="nexa-bob-slow pointer-events-none absolute -bottom-5 right-6 z-20 hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground lg:flex"
            >
              <span className="size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
              Nothing recorded
            </motion.span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/** The scrolling philosophy strip directly beneath the hero. */
export function TrustStrip() {
  const items = [
    "Private by design",
    "No meeting memory",
    "Anonymous identity",
    "Encrypted in transit",
    "Built for the web",
    "No ads, ever",
    "Guests join free",
  ];
  const row = [...items, ...items];

  return (
    <div className="nexa-marquee-host relative overflow-hidden border-y border-border bg-card">
      {/* soft edges so the loop reads as continuous */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[color:var(--background)] to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[color:var(--background)] to-transparent"
      />
      <ul className="nexa-marquee flex w-max items-center py-4">
        {row.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className="mr-10 flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground"
          >
            <span className="size-1 rounded-full bg-[color:var(--nexa-accent)]" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
