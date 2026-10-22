import { NexaLogo } from "@/components/NexaMark";
import { useIsDesktopViewport } from "@/hooks/use-mobile";
import { isDesktop } from "@/hooks/use-desktop";
import { DESKTOP_APP_DOWNLOAD_HREF } from "@/shared/constants";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { Download, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

const LINKS: Array<[string, string]> = [
  ["Product", "experience"],
  ["Privacy", "forgets"],
  ["Security", "security"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
];

/**
 * The landing's navigation: a plain full-width bar that gains a solid
 * background and hairline once you scroll, tucks away while scrolling down,
 * and returns the moment you scroll up. On mobile it collapses into a
 * simple panel. A hairline scroll-progress line rides the bottom edge.
 */
export function Nav({
  onStart,
  starting,
}: {
  onStart: () => void;
  starting: boolean;
}) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const lastY = useRef(0);

  // Desktop-only, and only for people who don't already have the app —
  // inside the shell they have it, so the button would be noise. The href
  // ships with a default (the public installer URL), so there is no
  // configuration this depends on.
  const showDownload = useIsDesktopViewport() && !isDesktop();

  const { scrollYProgress } = useScroll();
  const progressScaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    mass: 0.4,
  });

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 12);
      // tuck away going down (past the hero), return on any upward intent
      if (!menuOpen) {
        setHidden(y > lastY.current + 4 && y > 260);
        if (y < lastY.current - 4) setHidden(false);
      }
      lastY.current = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [menuOpen]);

  const go = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-all duration-300 ${
        scrolled || menuOpen
          ? "border-border bg-background"
          : "border-transparent"
      } ${
        hidden && !menuOpen ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div
        className={`mx-auto flex max-w-6xl items-center justify-between px-5 transition-all duration-300 sm:px-6 ${
          scrolled ? "h-14" : "h-20"
        }`}
      >
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Nexa home"
          className="shrink-0"
        >
          <NexaLogo markClassName="size-6" />
        </button>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LINKS.map(([label, id]) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className="nexa-underline rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/auth?returnTo=%2Fdashboard")}
            className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
          >
            Sign in          </button>
          {showDownload && (
            <a
              href={DESKTOP_APP_DOWNLOAD_HREF}
              download
              className="hidden rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
            >
              <Download className="size-4 inline mr-1.5 align-middle" />
              Download app
            </a>
          )}
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {starting ? "Opening…" : "Start a meeting"}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex size-9 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-muted md:hidden"
          >
            {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {/* mobile panel */}
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            aria-label="Mobile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border bg-background md:hidden"
          >
            <div className="mx-auto max-w-6xl px-5 py-2 sm:px-6">
              {LINKS.map(([label, id], index) => (
                <motion.button
                  key={id}
                  type="button"
                  onClick={() => go(id)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + index * 0.04 }}
                  className="flex w-full items-center justify-between border-b border-border/60 py-3.5 text-left text-[15px] text-foreground"
                >
                  {label}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    →
                  </span>
                </motion.button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/auth?returnTo=%2Fdashboard");
                }}
                className="w-full py-3.5 text-left text-[15px] text-muted-foreground"
              >
                Sign in
              </button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* scroll progress hairline */}
      <motion.div
        aria-hidden="true"
        style={{ scaleX: progressScaleX }}
        className="absolute inset-x-0 bottom-0 h-px origin-left bg-[color:var(--nexa-accent)]"
      />
    </header>
  );
}
