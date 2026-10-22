import { useEffect, useRef } from "react";

/**
 * Global keyboard shortcuts for the meeting room.
 *
 * Shortcuts never fire while the user is typing (inputs, textareas,
 * selects, contenteditable) or while a modifier is held, and Escape is
 * always left to panels/fullscreen. Handlers are read through a ref, so
 * callers can pass an inline object without re-binding on every render.
 */

type Handlers = Record<string, () => void>;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useShortcuts(handlers: Handlers, enabled: boolean): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") return;
      if (isTypingTarget(event.target)) return;
      const handler = handlersRef.current[event.key.toLowerCase()];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** The shortcut list shown in Settings → Accessibility (implemented only). */
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "M", action: "Mute or unmute the microphone" },
  { keys: "V", action: "Turn the camera on or off" },
  { keys: "S", action: "Start or stop screen sharing" },
  { keys: "C", action: "Open or close chat" },
  { keys: "P", action: "Open or close the participant list" },
  { keys: "E", action: "Open video effects" },
  { keys: "Esc", action: "Close panels, menus, and fullscreen" },
];
