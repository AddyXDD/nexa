import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const INTERACTIVE_SELECTOR =
  'a, button, [role="button"], input, textarea, select, [data-cursor="hover"]';

/**
 * A two-part custom cursor: an accent dot that tracks the pointer exactly and
 * a hairline ring that trails it with a little inertia. The ring grows and
 * tints jade over anything interactive, and contracts on press.
 *
 * Safety rules:
 * - only mounts on fine pointers (mice/trackpads) — touch devices keep the
 *   native behavior;
 * - the native cursor is hidden only while this component is mounted, so if
 *   the effect never runs the OS cursor stays put;
 * - with prefers-reduced-motion the ring stops trailing and snaps instead.
 */
export function CustomCursor() {
  const dotWrapRef = useRef<HTMLDivElement>(null);
  const ringWrapRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const root = document.documentElement;
    root.classList.add("nexa-cursor-none");

    const dotWrap = dotWrapRef.current!;
    const ringWrap = ringWrapRef.current!;
    const dot = dotRef.current!;
    const ring = ringRef.current!;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let ringX = targetX;
    let ringY = targetY;
    let hovering = false;
    let raf = 0;

    const render = () => {
      if (reduceMotion) {
        ringX = targetX;
        ringY = targetY;
      } else {
        ringX += (targetX - ringX) * 0.18;
        ringY += (targetY - ringY) * 0.18;
      }
      dotWrap.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
      ringWrap.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    const onMouseMove = (event: MouseEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      dotWrap.style.opacity = "1";
      ringWrap.style.opacity = "1";
    };

    const onMouseOver = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const next = !!target?.closest?.(INTERACTIVE_SELECTOR);
      if (next === hovering) return;
      hovering = next;
      ring.classList.toggle("is-hover", hovering);
      dot.classList.toggle("is-hover", hovering);
    };

    const onMouseDown = () => ring.classList.add("is-down");
    const onMouseUp = () => ring.classList.remove("is-down");
    const onMouseLeave = () => {
      dotWrap.style.opacity = "0";
      ringWrap.style.opacity = "0";
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mouseover", onMouseOver, { passive: true });
    window.addEventListener("mousedown", onMouseDown, { passive: true });
    window.addEventListener("mouseup", onMouseUp, { passive: true });
    document.documentElement.addEventListener("mouseleave", onMouseLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseover", onMouseOver);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.documentElement.removeEventListener(
        "mouseleave",
        onMouseLeave,
      );
      root.classList.remove("nexa-cursor-none");
    };
  }, []);

  // Rendered unconditionally; styles only activate once the effect runs on a
  // fine pointer, and opacity starts at 0 in CSS either way.
  //
  // Portalled to <body> rather than left in the landing subtree: that subtree
  // sets `isolate`, which traps these two in a stacking context of their own
  // where the z-index only competes with the page. Anything portalled to
  // <body> — the terms popup — then paints straight over them, and because
  // the native cursor is hidden document-wide for as long as this is
  // mounted, the pointer vanished completely. From <body> the z-index
  // competes at the root, above every overlay in the app.
  return createPortal(
    <>
      <div
        ref={dotWrapRef}
        className="nexa-cursor-dot"
        aria-hidden="true"
        style={{ opacity: 0 }}
      >
        <span ref={dotRef} />
      </div>
      <div
        ref={ringWrapRef}
        className="nexa-cursor-ring"
        aria-hidden="true"
        style={{ opacity: 0 }}
      >
        <span ref={ringRef} />
      </div>
    </>,
    document.body,
  );
}
