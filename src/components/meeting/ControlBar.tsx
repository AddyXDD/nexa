import { NexaMark } from "@/components/NexaMark";
import type { NoiseLevel } from "@/hooks/use-local-media";
import type { LayoutChoice } from "@/hooks/use-ui-prefs";
import { REACTIONS } from "@/hooks/use-reactions";
import { startLevelMeter } from "@/lib/media/audio";
import { SUPPORT_EMAIL } from "@/shared/constants";
import {
  ChevronDown,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  ScreenShare,
  ScreenShareOff,
  SmilePlus,
  StickyNote,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { SettingsSection } from "./SettingsPanel";

/**
 * The spine.
 *
 * Every meeting app puts its controls in a bar across the bottom of the
 * video. This room doesn't: the instruments live in a vertical strip down
 * the left edge, like the channel strip of a mixing desk. Brand at the top,
 * the live mic fader beneath it, then the device keys, the room tools, and
 * the leave key at the floor.
 *
 * Reading top to bottom is reading the room: how loud you are, whether your
 * devices are open, who is here, what has been said, and finally the way out.
 * Labels slide out to the right on hover — the rail itself stays wordless so
 * the wall keeps every pixel it can.
 *
 * Device keys are split: the face toggles, the thin chevron below it opens
 * the device menu. A closed device is dark red, never a solid red pill.
 */

type MenuId = "mic" | "cam" | "reactions" | "more";

const SEGMENTS = 9;

export type ControlBarProps = {
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
  /** Raw input track, for the live fader. */
  micSource: MediaStreamTrack | null;
  participantCount: number;
  peopleOpen: boolean;
  chatOpen: boolean;
  notesOpen: boolean;
  /** Unread chat messages while the chat panel is hidden. */
  chatUnread: number;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleShare: () => void;
  onTogglePeople: () => void;
  onToggleChat: () => void;
  onToggleNotes: () => void;
  onOpenSettings: (section: SettingsSection) => void;
  onOpenEffects: () => void;
  onToggleFullscreen: () => void;
  fullscreen: boolean;
  onTogglePip: () => void;
  pipAvailable: boolean;
  onReaction: (emoji: string) => void;
  onLeave: () => void;
  /* contextual menus */
  noiseLevel: NoiseLevel;
  onSetNoise: (level: NoiseLevel) => void;
  inputs: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  selectedMicId: string | null;
  onSelectMic: (deviceId: string) => void;
  selectedCamId: string | null;
  onSelectCam: (deviceId: string) => void;
  mirrorSelfView: boolean;
  onToggleMirror: () => void;
  /* layout */
  layout: LayoutChoice;
  onSetLayout: (layout: LayoutChoice) => void;
  pinned: boolean;
  onClearPin: () => void;
  /** Where your own plate lives — recoverable without hunting the wall. */
  selfMode: "grid" | "floating" | "hidden";
  onSetSelfMode: (mode: "grid" | "floating" | "hidden") => void;
  reduced: boolean;
};

export function ControlBar(props: ControlBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);

  // Escape closes the top-most UI layer (menus before panels — the page
  // handler checks nothing is open before closing panels).
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpenMenu(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openMenu]);

  const close = () => setOpenMenu(null);
  const toggle = (menu: MenuId) =>
    setOpenMenu((current) => (current === menu ? null : menu));

  return (
    <>
      {openMenu && (
        <div className="fixed inset-0 z-30" onClick={close} aria-hidden />
      )}

      <nav
        aria-label="Meeting instruments"
        className="nexa-spine relative z-40 col-start-1 row-start-1 row-span-2 flex h-full min-h-0 w-full flex-col items-center gap-[2px] overflow-y-auto py-2 [scrollbar-width:none] sm:overflow-visible sm:py-3"
      >
        {/* ------------------------------------------------------- identity */}
        <span
          aria-hidden
          className="mb-1 grid h-6 w-6 shrink-0 place-items-center"
        >
          <NexaMark className="size-6" />
        </span>

        {/* ----------------------------------------------------------- fader */}
        <MicFader source={props.micSource} live={props.micOn} />

        {/* -------------------------------------------------------- devices */}
        <DeviceKey
          label={props.micOn ? "Mute microphone" : "Unmute microphone"}
          caption={props.micOn ? "Mic" : "Muted"}
          hint="M"
          open={openMenu === "mic"}
          onToggle={props.onToggleMic}
          onOpenMenu={() => toggle("mic")}
          danger={!props.micOn}
          anchor="top"
          menu={
            <Menu label="Microphone and noise">
              <MenuSectionLabel>Microphone</MenuSectionLabel>
              {props.inputs.length === 0 && (
                <p className="px-3 py-1.5 text-[11px] text-[color:var(--nexa-ink)]/45">
                  No devices reported yet.
                </p>
              )}
              <div className="max-h-40 overflow-y-auto">
                {props.inputs.slice(0, 8).map((device, index) => (
                  <MenuItem
                    key={device.deviceId || index}
                    checked={
                      (props.selectedMicId ?? props.inputs[0]?.deviceId) ===
                      device.deviceId
                    }
                    onSelect={() => props.onSelectMic(device.deviceId)}
                  >
                    {device.label || `Microphone ${index + 1}`}
                  </MenuItem>
                ))}
              </div>
              <MenuSeparator />
              <MenuSectionLabel>Noise reduction</MenuSectionLabel>
              {(
                [
                  ["off", "Off"],
                  ["standard", "Standard"],
                  ["strong", "Strong"],
                ] as [NoiseLevel, string][]
              ).map(([value, label]) => (
                <MenuItem
                  key={value}
                  checked={props.noiseLevel === value}
                  onSelect={() => props.onSetNoise(value)}
                >
                  {label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={() => props.onOpenSettings("audio")}>
                Test microphone…
              </MenuItem>
            </Menu>
          }
        >
          {props.micOn ? (
            <Mic className={ICON} />
          ) : (
            <MicOff className={ICON} />
          )}
        </DeviceKey>

        <DeviceKey
          label={props.camOn ? "Turn camera off" : "Turn camera on"}
          caption={props.camOn ? "Camera" : "Camera off"}
          hint="V"
          open={openMenu === "cam"}
          onToggle={props.onToggleCam}
          onOpenMenu={() => toggle("cam")}
          danger={!props.camOn}
          anchor="top"
          menu={
            <Menu label="Camera and effects">
              <MenuSectionLabel>Camera</MenuSectionLabel>
              {props.cameras.length === 0 && (
                <p className="px-3 py-1.5 text-[11px] text-[color:var(--nexa-ink)]/45">
                  No devices reported yet.
                </p>
              )}
              <div className="max-h-40 overflow-y-auto">
                {props.cameras.slice(0, 8).map((device, index) => (
                  <MenuItem
                    key={device.deviceId || index}
                    checked={
                      (props.selectedCamId ?? props.cameras[0]?.deviceId) ===
                      device.deviceId
                    }
                    onSelect={() => props.onSelectCam(device.deviceId)}
                  >
                    {device.label || `Camera ${index + 1}`}
                  </MenuItem>
                ))}
              </div>
              <MenuSeparator />
              <MenuItem onSelect={props.onOpenEffects}>Effects…</MenuItem>
              <MenuItem onSelect={() => props.onOpenSettings("video")}>
                Video settings…
              </MenuItem>
              <MenuItem
                checked={props.mirrorSelfView}
                onSelect={props.onToggleMirror}
              >
                Mirror self-view
              </MenuItem>
            </Menu>
          }
        >
          {props.camOn ? (
            <Video className={ICON} />
          ) : (
            <VideoOff className={ICON} />
          )}
        </DeviceKey>

        {/* ---------------------------------------------------------- share */}
        <Rail />
        <Key
          label={props.sharing ? "Stop presenting" : "Present your screen"}
          caption={props.sharing ? "Presenting" : "Present"}
          hint="S"
          active={props.sharing}
          highlight
          onClick={props.onToggleShare}
        >
          {props.sharing ? (
            <ScreenShareOff className={ICON} />
          ) : (
            <ScreenShare className={ICON} />
          )}
        </Key>

        <Rail />

        {/* ------------------------------------------------------- the room */}
        <Key
          label="Participants"
          caption="People"
          hint="P"
          active={props.peopleOpen}
          onClick={props.onTogglePeople}
          badge={<CountBadge value={props.participantCount} />}
        >
          <Users className={ICON} />
        </Key>

        <Key
          label={
            props.chatUnread > 0
              ? `Chat — ${props.chatUnread} unread`
              : "Chat"
          }
          caption="Chat"
          hint="C"
          active={props.chatOpen}
          onClick={props.onToggleChat}
          badge={
            props.chatUnread > 0 ? (
              <CountBadge value={props.chatUnread} />
            ) : undefined
          }
        >
          <MessageSquare className={ICON} />
        </Key>

        <Key
          label="Your notes — this device only"
          caption="Notes"
          hint="N"
          active={props.notesOpen}
          onClick={props.onToggleNotes}
        >
          <StickyNote className={ICON} />
        </Key>

        <Rail />

        {/* ------------------------------------------------------ reactions */}
        <Popover
          label="Send a reaction"
          caption="React"
          open={openMenu === "reactions"}
          onToggle={() => toggle("reactions")}
          anchor="bottom"
          icon={<SmilePlus className={ICON} />}
          menu={
            <div className="w-max border border-[color:var(--nexa-ink)]/15 bg-[color:var(--nexa-bone)] p-2 text-[color:var(--nexa-ink)] shadow-[0_28px_60px_-28px_rgba(0,0,0,0.8)]">
              <p className="nexa-label px-1 pb-2 text-[color:var(--nexa-ink)]/40">
                Send
              </p>
              <div className="grid grid-cols-4 gap-1">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Send ${emoji}`}
                    onClick={() => {
                      props.onReaction(emoji);
                      close();
                    }}
                    className="inline-flex size-9 items-center justify-center text-lg transition-colors hover:bg-black/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        <Popover
          label="More instruments"
          caption="More"
          open={openMenu === "more"}
          onToggle={() => toggle("more")}
          anchor="bottom"
          icon={<MoreHorizontal className={ICON} />}
          menu={
            <Menu label="Meeting instruments" align="right">
              <MenuSectionLabel>Composition</MenuSectionLabel>
              <MenuItem
                checked={props.layout === "auto"}
                onSelect={() => props.onSetLayout("auto")}
              >
                Wall — everyone a plate
              </MenuItem>
              <MenuItem
                checked={props.layout === "sidebar"}
                onSelect={() => props.onSetLayout("sidebar")}
              >
                Stage — one plate, filmstrip below
              </MenuItem>
              <MenuItem
                checked={props.layout === "spotlight"}
                onSelect={() => props.onSetLayout("spotlight")}
              >
                Spotlight — the stage alone
              </MenuItem>
              {props.pinned && (
                <>
                  <MenuSeparator />
                  <MenuItem onSelect={props.onClearPin}>
                    Clear pinned participant
                  </MenuItem>
                </>
              )}
              <MenuSeparator />
              <MenuSectionLabel>Your self-view</MenuSectionLabel>
              <MenuItem
                checked={props.selfMode === "floating"}
                onSelect={() => props.onSetSelfMode("floating")}
              >
                Floating plate
              </MenuItem>
              <MenuItem
                checked={props.selfMode === "grid"}
                onSelect={() => props.onSetSelfMode("grid")}
              >
                On the wall
              </MenuItem>
              <MenuItem
                checked={props.selfMode === "hidden"}
                onSelect={() => props.onSetSelfMode("hidden")}
              >
                Hidden
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={props.onOpenEffects}>Effects…</MenuItem>
              <MenuItem onSelect={() => props.onOpenSettings("audio")}>
                Audio settings…
              </MenuItem>
              <MenuItem onSelect={() => props.onOpenSettings("video")}>
                Video settings…
              </MenuItem>
              <MenuItem onSelect={() => props.onOpenSettings("accessibility")}>
                Keyboard shortcuts…
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={props.onToggleFullscreen}
                checked={props.fullscreen}
              >
                {props.fullscreen ? "Leave fullscreen" : "Fullscreen"}
              </MenuItem>
              <MenuItem
                onSelect={props.onTogglePip}
                disabled={!props.pipAvailable}
                hint={props.pipAvailable ? undefined : "unsupported"}
              >
                Picture-in-picture
              </MenuItem>
              <MenuSeparator />
              <ReportProblem />
            </Menu>
          }
        />

        {/* ---------------------------------------------------------- leave */}
        <div className="group relative flex min-h-[44px] w-full flex-1 flex-col items-center justify-center">
          <button
            type="button"
            onClick={props.onLeave}
            aria-label="Leave meeting"
            title="Leave meeting"
            className="flex w-full flex-col items-center gap-[3px] rounded-[5px] py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0c0f]"
          >
            <span className="grid size-8 place-items-center bg-[#B3261E]/10 text-[#FF7A6E] ring-1 ring-inset ring-[#B3261E]/45 transition-colors group-hover:bg-[#B3261E] group-hover:text-white">
              <LogOut className={ICON} />
            </span>
            <span className="w-full text-center font-mono text-[8px] uppercase leading-none tracking-[0.08em] text-[#FF7A6E] transition-colors group-hover:text-white sm:text-[9px]">
              Leave
            </span>
          </button>
          <Tip label="Leave meeting" />
        </div>
      </nav>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The rail's parts
 * ------------------------------------------------------------------ */

const ICON = "size-4 shrink-0";
/**
 * One rail item: a key and the word that explains it, as one target. Items
 * share the height of the rail equally, so the bar is filled top to bottom
 * rather than collecting at the top above a dead zone.
 */
const ITEM =
  "group relative flex min-h-[44px] w-full flex-1 flex-col items-center justify-center";
const BUTTON =
  "flex w-full flex-col items-center gap-[3px] rounded-[5px] py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0c0f]";
const CAPTION =
  "w-full truncate px-0.5 text-center font-mono text-[8.5px] uppercase leading-none tracking-[0.08em] transition-colors sm:text-[9px]";
const IDLE =
  "text-white/80 group-hover:bg-white/[0.07] group-hover:text-white";
const ON = "bg-[color:var(--nexa-bone)] text-[color:var(--nexa-ink)]";
const LIT =
  "bg-[color:var(--nexa-accent)] text-[color:var(--nexa-accent-ink)] group-hover:brightness-105";
/** A closed device: dark red, unmissable, not a red plastic pill. */
const SHUT =
  "bg-[#2A1013] text-[#FF7A6E] ring-1 ring-[#7A2620] group-hover:bg-[#341317]";
const CAPTION_IDLE = "text-white/90 group-hover:text-white";
const CAPTION_OPEN = "text-[color:var(--nexa-accent)]";
const CAPTION_SHUT = "text-[#FF7A6E]";
const MENU_POSITION =
  "fixed bottom-2 left-[68px] right-2 z-[60] sm:absolute sm:bottom-auto sm:left-[calc(100%+10px)] sm:right-auto sm:z-50";

/**
 * The live fader, isolated in its own component: it re-renders on the audio
 * frame, so keeping it out of the rail means speech never re-renders the
 * menus, the tool keys or the labels beside them.
 */
function MicFader({
  source,
  live,
}: {
  source: MediaStreamTrack | null;
  live: boolean;
}) {
  const [rawLevel, setRawLevel] = useState(0);

  useEffect(() => {
    if (!source) return;
    const meter = startLevelMeter(new MediaStream([source]), setRawLevel);
    if (!meter) return;
    return () => meter.stop();
  }, [source]);

  // A muted microphone reads zero even though the track is still capturing.
  const level = live ? rawLevel : 0;
  const lit = Math.round(
    Math.min(1, Math.sqrt(Math.max(0, Math.min(1, level))) * 1.08) * SEGMENTS,
  );

  return (
    <div
      role="meter"
      aria-label="Microphone input level"
      aria-valuenow={Math.round(level * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="nexa-fader flex shrink-0 flex-col-reverse items-center gap-[2px] pb-1"
    >
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <span
          key={index}
          className={`block h-[2px] w-[13px] rounded-full ${
            index < lit ? "bg-[color:var(--nexa-accent)]" : "bg-white/[0.22]"
          }`}
        />
      ))}
    </div>
  );
}

function Rail() {
  return (
    <span
      aria-hidden
      className="my-1 h-px w-6 shrink-0 bg-white/15 sm:w-7"
    />
  );
}

function Key({
  label,
  caption,
  hint,
  active = false,
  highlight = false,
  onClick,
  badge,
  children,
}: {
  label: string;
  /** The word printed under the key — the point is that nobody has to guess. */
  caption: string;
  hint?: string;
  active?: boolean;
  highlight?: boolean;
  onClick: () => void;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={ITEM}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={BUTTON}
      >
        <span
          className={`relative grid size-8 place-items-center rounded-[4px] transition-colors duration-150 ${
            highlight && active ? LIT : active ? ON : IDLE
          }`}
        >
          {children}
          {badge}
        </span>
        <span
          className={`${CAPTION} ${active ? CAPTION_OPEN : CAPTION_IDLE}`}
        >
          {caption}
        </span>
      </button>
      <Tip label={label} hint={hint} />
    </div>
  );
}

function DeviceKey({
  label,
  caption,
  hint,
  open,
  onToggle,
  onOpenMenu,
  danger,
  menu,
  anchor = "top",
  children,
}: {
  label: string;
  /** Printed under the key. Reads "Muted" when the device is closed. */
  caption: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  onOpenMenu: () => void;
  danger: boolean;
  menu: ReactNode;
  anchor?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <div className={ITEM}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        className={`${BUTTON} pb-0`}
      >
        <span
          className={`grid size-8 place-items-center rounded-[4px] transition-colors duration-150 ${
            danger ? SHUT : IDLE
          }`}
        >
          {children}
        </span>
      </button>

      {/* The caption doubles as the device menu: the word names the key, the
          chevron says it opens something. */}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={`${label} — device options`}
        aria-expanded={open}
        title={`${caption} — choose a device`}
        className={`flex w-full items-center justify-center gap-0.5 rounded-[4px] py-[3px] font-mono text-[8px] uppercase leading-none tracking-[0.06em] outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)] sm:text-[9px] ${
          danger
            ? CAPTION_SHUT
            : open
              ? "text-white"
              : CAPTION_IDLE
        }`}
      >
        <span className="max-w-full truncate">{caption}</span>
        <ChevronDown
          className={`size-2 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <Tip label={label} hint={hint} hidden={open} />

      {open && (
        <div
          className={`${MENU_POSITION} ${
            anchor === "top" ? "sm:top-0" : "sm:bottom-0"
          }`}
        >
          {menu}
        </div>
      )}
    </div>
  );
}

function Popover({
  label,
  caption,
  icon,
  open,
  onToggle,
  menu,
  anchor = "bottom",
}: {
  label: string;
  caption: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  menu: ReactNode;
  anchor?: "top" | "bottom";
}) {
  return (
    <div className={ITEM}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={open}
        className={BUTTON}
      >
        <span
          className={`grid size-8 place-items-center rounded-[4px] transition-colors duration-150 ${
            open ? ON : IDLE
          }`}
        >
          {icon}
        </span>
        <span className={`${CAPTION} ${open ? CAPTION_OPEN : CAPTION_IDLE}`}>
          {caption}
        </span>
      </button>
      <Tip label={label} hidden={open} />
      {open && (
        <div
          className={`${MENU_POSITION} ${
            anchor === "top" ? "sm:top-0" : "sm:bottom-0"
          }`}
        >
          {menu}
        </div>
      )}
    </div>
  );
}

/** The label that slides out of the rail on hover, with its shortcut. */
function Tip({
  label,
  hint,
  hidden = false,
}: {
  label: string;
  hint?: string;
  /** Suppressed while this item's menu is open — they share the same space. */
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 hidden -translate-y-1/2 items-center gap-2 whitespace-nowrap bg-[color:var(--nexa-bone)] px-2 py-1.5 text-[11px] font-medium text-[color:var(--nexa-ink)] opacity-0 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.9)] transition-opacity delay-200 duration-100 group-hover:opacity-100 group-focus-within:opacity-100 sm:flex"
    >
      {label}
      {hint && (
        <kbd className="border border-[color:var(--nexa-ink)]/20 px-1 font-mono text-[9px] leading-4 text-[color:var(--nexa-ink)]/45">
          {hint}
        </kbd>
      )}
    </span>
  );
}

function CountBadge({ value }: { value: number }) {
  return (
    <span className="absolute -right-0.5 -top-0.5 grid min-w-[14px] place-items-center rounded-full bg-[color:var(--nexa-accent)] px-1 py-[1px] font-mono text-[8.5px] font-semibold leading-none text-[color:var(--nexa-accent-ink)] ring-2 ring-[#0d0e11]">
      {value > 99 ? "99+" : value}
    </span>
  );
}

function Menu({
  label,
  children,
  align = "left",
}: {
  label: string;
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      role="menu"
      aria-label={label}
      className={`max-h-[70vh] w-[min(16.5rem,calc(100vw-5rem))] overflow-y-auto overscroll-contain border border-[color:var(--nexa-ink)]/15 bg-[color:var(--nexa-bone)] p-1.5 text-[color:var(--nexa-ink)] shadow-[0_30px_70px_-30px_rgba(0,0,0,0.85)] ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </div>
  );
}

function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="nexa-label px-3 pb-1.5 pt-2.5 text-[color:var(--nexa-ink)]/40">
      {children}
    </p>
  );
}

function MenuSeparator() {
  return <div aria-hidden className="my-1.5 h-px bg-[color:var(--nexa-ink)]/10" />;
}

function MenuItem({
  children,
  checked,
  onSelect,
  disabled,
  hint,
}: {
  children: ReactNode;
  checked?: boolean;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked ?? false}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)] ${
        disabled
          ? "cursor-not-allowed text-[color:var(--nexa-ink)]/30"
          : "text-[color:var(--nexa-ink)]/85 hover:bg-black/[0.06] hover:text-[color:var(--nexa-ink)]"
      }`}
    >
      <span className="truncate">{children}</span>
      {hint && (
        <span className="font-mono text-[10px] text-[color:var(--nexa-ink)]/40">
          {hint}
        </span>
      )}
      {checked && (
        <span className="size-1.5 shrink-0 rounded-full bg-[color:var(--nexa-ink)]" />
      )}
    </button>
  );
}

function ReportProblem() {
  return (
    <a
      href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
        "Nexa Meet — report a problem",
      )}&body=${encodeURIComponent(
        `Meeting code: ${window.location.pathname}\nBrowser: ${navigator.userAgent}\n\nWhat happened?`,
      )}`}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[color:var(--nexa-ink)]/60 transition-colors hover:bg-black/[0.06] hover:text-[color:var(--nexa-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
      role="menuitem"
    >
      Report a problem
    </a>
  );
}
