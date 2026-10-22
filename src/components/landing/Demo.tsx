import { Reveal, SectionHead } from "./ui";
import { MeetingWindow } from "./MeetingWindow";

const PRIVACY_STATUS: Array<[string, string]> = [
  ["Recording", "None: the feature doesn't exist"],
  ["Media path", "Peer to peer, encrypted in transit"],
  ["Server sees", "Connection signals only"],
  ["Chat & roster", "Wiped when the room empties"],
  ["Your identity", "Random Nexa ID, never derived from you"],
];

const ACTIONS = [
  "Toggle the microphone",
  "Turn the camera off",
  "Blur the background",
  "Force a video quality",
  "Open participants and chat",
  "Simulate a poor network",
];

/**
 * The interactive product demo: a simulated Nexa room (no camera, no
 * network) beside a control checklist and a live privacy-status panel, so a
 * visitor can operate the interface and watch it adapt before ever opening a
 * real meeting.
 */
export function LiveDemo() {
  return (
    <section id="demo" className="scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
        <SectionHead
          eyebrow="Interactive demo"
          title="Try the room first."
          sub="A simulated Nexa meeting running entirely in your browser. Toggle things, drop the network, watch the picture adapt; nothing here touches a camera or your connection."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-[7fr_5fr]">
          <Reveal>
            <MeetingWindow lab />
          </Reveal>

          <div className="flex flex-col gap-4">
            <Reveal delay={0.06}>
              <div className="rounded-xl border border-border bg-card p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  What you can do
                </p>
                <ul className="mt-4 space-y-2.5">
                  {ACTIONS.map((action, index) => (
                    <li
                      key={action}
                      className="flex items-baseline gap-3.5 text-sm text-foreground/85"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            <Reveal delay={0.12}>
              <div className="rounded-xl border border-[color:var(--nexa-accent)]/30 bg-card p-6">
                <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--nexa-accent)]">
                  Privacy status
                  <span className="nexa-pulse ml-auto size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
                </p>
                <dl className="mt-4 space-y-3">
                  {PRIVACY_STATUS.map(([term, value]) => (
                    <div
                      key={term}
                      className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-2.5 last:border-b-0 last:pb-0"
                    >
                      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        {term}
                      </dt>
                      <dd className="text-right text-xs leading-relaxed text-foreground/85">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
