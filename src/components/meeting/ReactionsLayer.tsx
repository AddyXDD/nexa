import type { Reaction } from "@/hooks/use-reactions";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Floating reactions: the emoji pops big — everyone in the room reads it
 * at a glance, from the back of a phone screen — then rises and fades.
 * Travel is slow and the fade is late so it never flickers; reduced
 * motion renders it as a soft fade with no travel.
 */
export function ReactionsLayer({
  items,
  reduced,
}: {
  items: Reaction[];
  reduced: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div
      aria-hidden
      // Tall enough that a 56px emoji can rise clear of the plates' caption
      // tabs and the filmstrip at the bottom of the wall.
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-96 overflow-hidden sm:h-80"
    >
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={
              reduced
                ? { opacity: 0, scale: 0.9 }
                : { opacity: 0, scale: 0.4, y: 0 }
            }
            animate={
              reduced
                ? { opacity: [0, 1, 1, 0], scale: 1 }
                : { opacity: [0, 1, 1, 0], scale: [0.4, 1.25, 1, 1], y: -210 }
            }
            exit={{ opacity: 0 }}
            transition={{
              duration: reduced ? 1.6 : 2.4,
              times: reduced ? [0, 0.15, 0.7, 1] : [0, 0.12, 0.72, 1],
              ease: "easeOut",
            }}
            style={{ left: `${(item.lane * 100).toFixed(1)}%` }}
            className="absolute bottom-6 text-5xl leading-none drop-shadow-[0_10px_28px_rgba(0,0,0,0.5)] sm:bottom-8 sm:text-6xl"
          >
            {item.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}