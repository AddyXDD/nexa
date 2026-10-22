import type { ChatMessage, ChatScope, DirectPeer, Participant } from "@/shared/types";
import { loadValue, saveJson } from "@/lib/prefs";
import {
  Loader2,
  Lock,
  MessageCircle,
  Mic,
  MicOff,
  Send,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

/** What the panel needs from useMeetingChat, for the room and for DMs. */
type ChatPanelProps = {
  scope: ChatScope;
  setScope: (scope: ChatScope) => void;
  peerSessionId: string | null;
  openDirect: (sessionId: string | null) => void;
  peers: DirectPeer[];
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  onSend: (text: string) => Promise<void>;
  /** Unread messages in chat while this panel is hidden. */
  unread: number;
};

/**
 * The desk sheet: who's in the room, the temporary chat, and your private
 * notes.
 *
 * A sheet of bone paper laid over the right edge of the ink wall — the one
 * place in the room that is for reading and writing rather than watching.
 * Tabs are typeset mono labels with an ink underline, not pills. Chat has
 * two channels: everyone in the room,
 * and a one-to-one thread with a single person. Direct messages are stored
 * under a key only the two participants can read, so the room transcript
 * can't pick them up. Chat exists only while the meeting does — the server
 * deletes every message the moment the room closes, and the footer says so
 * plainly. Own messages sit right, tinted sapphire.
 * Notes never leave this device: they're written straight to
 * localStorage under the meeting code and sent nowhere.
 */
export function SidePanel({
  tab,
  onTabChange,
  onClose,
  participants,
  selfSessionId,
  chat,
  code,
}: {
  tab: "people" | "chat" | "notes";
  onTabChange: (tab: "people" | "chat" | "notes") => void;
  onClose: () => void;
  participants: Participant[];
  selfSessionId: string;
  chat?: ChatPanelProps;
  /** Meeting code — keys the local-only notes storage. */
  code: string;
}) {
  return (
    <motion.aside
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 32, opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="nexa-chrome absolute inset-y-0 right-0 z-30 flex w-full flex-col overflow-hidden border-l border-[color:var(--nexa-ink)]/15 bg-[color:var(--nexa-bone)] text-[color:var(--nexa-ink)] shadow-[-24px_0_60px_-40px_rgba(0,0,0,0.85)] sm:w-[23rem]"
      aria-label="Meeting panel"
    >
      <div className="flex h-12 shrink-0 items-stretch gap-1 border-b border-[color:var(--nexa-ink)]/12 px-3">
        <div className="flex items-stretch gap-1">
          <PanelTab
            active={tab === "people"}
            onClick={() => onTabChange("people")}
          >
            People · {participants.length}
          </PanelTab>
          <PanelTab active={tab === "chat"} onClick={() => onTabChange("chat")}>
            Chat
            {chat && chat.unread > 0 && (
              <UnreadBadge
                count={chat.unread}
                className="ml-1.5 bg-[color:var(--nexa-accent)] text-[color:var(--nexa-accent-ink)]"
              />
            )}
          </PanelTab>
          <PanelTab
            active={tab === "notes"}
            onClick={() => onTabChange("notes")}
          >
            Notes
          </PanelTab>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close panel"
          aria-label="Close panel"
          className="ml-auto inline-flex size-8 items-center justify-center self-center text-[color:var(--nexa-ink)]/35 transition-colors hover:bg-black/[0.06] hover:text-[color:var(--nexa-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
        >
          <X className="size-4" />
        </button>
      </div>

      {tab === "people" ? (
        <ul className="flex-1 overflow-y-auto py-1.5">
          {participants.map((participant) => (
            <PersonRow
              key={participant.sessionId}
              participant={participant}
              isSelf={participant.sessionId === selfSessionId}
              onMessage={
                participant.sessionId === selfSessionId || !chat
                  ? undefined
                  : () => {
                      chat.openDirect(participant.sessionId);
                      onTabChange("chat");
                    }
              }
            />
          ))}
        </ul>
      ) : tab === "notes" ? (
        <NotesPanel code={code} />
      ) : chat ? (
        <ChatPanel
          chat={chat}
          participants={participants}
          selfSessionId={selfSessionId}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Chat becomes available once you&apos;re in the room.
        </div>
      )}
    </motion.aside>
  );
}

function PanelTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative inline-flex items-center px-2 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)] ${
        active
          ? "text-[color:var(--nexa-ink)]"
          : "text-[color:var(--nexa-ink)]/35 hover:text-[color:var(--nexa-ink)]/70"
      }`}
    >
      {children}
      {active && (
        <span className="absolute inset-x-1 bottom-0 h-[2px] bg-[color:var(--nexa-ink)]" />
      )}
    </button>
  );
}

/**
 * Small unread pill for the Chat tab and the direct-message channel tab.
 * Duplicated by the count in accessible text via aria-label on the tabs,
 * so the number is never the only signal.
 */
function UnreadBadge({
  count,
  className = "",
}: {
  count: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex min-w-4 shrink-0 items-center justify-center rounded-full px-1 py-0.5 text-[9px] font-semibold leading-none ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Private scratchpad — one per meeting, kept in this browser only.
 * Nothing is broadcast or persisted server-side; the room never sees it.
 */
function NotesPanel({ code }: { code: string }) {
  const [text, setText] = useState(() =>
    loadValue<string>(`notes.${code}`, ""),
  );

  const update = (value: string) => {
    setText(value);
    saveJson(`notes.${code}`, value);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <textarea
        value={text}
        onChange={(event) => update(event.target.value)}
        placeholder="Action items, decisions, timestamps…"
        aria-label="Personal notes"
        spellCheck
        className="min-h-40 flex-1 resize-none border border-input bg-[color:var(--nexa-card)] p-3.5 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color:var(--nexa-accent)]/60"
      />
      <div className="mt-2 flex items-start justify-between gap-2 px-0.5">
        <p className="text-[10px] leading-snug text-muted-foreground">
          Private — saved on this device only, never shared with the room.
        </p>
        {text.length > 0 && (
          <button
            type="button"
            onClick={() => update("")}
            className="shrink-0 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function PersonRow({
  participant,
  isSelf,
  onMessage,
}: {
  participant: Participant;
  isSelf: boolean;
  /** Opens a private thread with this person. */
  onMessage?: () => void;
}) {
  const monogram = (participant.displayName ?? participant.nexaId)
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li className="mx-1.5 flex items-center gap-3 rounded-[2px] px-2.5 py-2.5 transition-colors hover:bg-muted/70">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-[color:var(--nexa-ink)]/[0.05] text-[11px] font-semibold text-foreground">
        {monogram || "NX"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {participant.displayName ?? "Guest"}
          </span>
          {isSelf && (
            <span className="rounded-[2px] bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
              You
            </span>
          )}
          {participant.isHost && (
            <span className="rounded-[2px] bg-[color:var(--nexa-accent)]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--nexa-accent)] ring-1 ring-[color:var(--nexa-accent)]/25">
              Host
            </span>
          )}
        </div>        <span className="font-mono text-xs text-muted-foreground">
          {participant.nexaId}
        </span>
      </div>
      {participant.sharing && (
        <span className="rounded-[2px] bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
          Presenting
        </span>
      )}
      <span
        title={participant.micOn ? "Microphone on" : "Microphone muted"}        className={`inline-flex items-center gap-1 text-[11px] font-medium ${
          participant.micOn ? "text-muted-foreground" : "text-[#B3261E]"
        }`}
      >
        {participant.micOn ? (                  <Mic className="size-4" />
        ) : (                  <MicOff className="size-4" />
        )}
        <span className="sr-only">
          {participant.micOn ? "Microphone on" : "Muted"}
        </span>
      </span>
      {onMessage && (
        <button
          type="button"
          onClick={onMessage}
          title={`Message ${participant.displayName ?? "this person"} privately`}
          aria-label={`Message ${participant.displayName ?? "this person"} privately`}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
        >                  <MessageCircle className="size-4" />
        </button>
      )}
    </li>
  );
}

function ChatPanel({
  chat,
  participants,
  selfSessionId,
}: {
  chat: ChatPanelProps;
  participants: Participant[];
  selfSessionId: string;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const direct = chat.scope === "dm";
  // Which channel a failed send belonged to, so a private-send error doesn't
  // linger under Everyone after the user switches channels.
  const [failedScope, setFailedScope] = useState<ChatScope | null>(null);

  // Everyone in the room you can write to, plus anyone you've already had a
  // thread with — a person who leaves keeps the conversation readable.
  const people = useMemo(() => {
    const seen = new Set<string>();
    const out: DirectPeer[] = [];
    for (const participant of participants) {
      if (participant.sessionId === selfSessionId) continue;
      seen.add(participant.sessionId);
      out.push({
        sessionId: participant.sessionId,
        nexaId: participant.nexaId,
        displayName: participant.displayName,
        lastSentAt: 0,
        inRoom: true,
      });
    }
    for (const peer of chat.peers) {
      if (seen.has(peer.sessionId)) continue;
      out.push(peer);
    }
    return out;
  }, [participants, chat.peers, selfSessionId]);

  const peer = people.find((p) => p.sessionId === chat.peerSessionId) ?? null;
  const peerName = peer?.displayName ?? "this person";
  // No thread open yet: there's nobody to send to, so there's no composer.
  const canSend = !direct || chat.peerSessionId !== null;

  // Unread per channel. Everyone: room messages from others newer than the
  // newest message currently shown (the panel is open, so shown = seen).
  // Direct: one per thread whose last activity is newer than that — never
  // counting the thread currently on screen.
  const newestShownSentAt = chat.messages.reduce(
    (latest, message) =>
      message.sentAt > latest ? message.sentAt : latest,
    0,
  );
  const everyoneUnread = chat.messages.filter(
    (message) =>
      message.scope === "everyone" &&
      message.sessionId !== selfSessionId &&
      message.sentAt > newestShownSentAt,
  ).length;
  const directUnreadPeers = chat.peers.filter((thread) =>
    chat.peerSessionId === thread.sessionId
      ? false
      : thread.lastSentAt > newestShownSentAt,
  ).length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.messages.length]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || chat.sending || !canSend) return;
    setDraft("");
    try {
      await chat.onSend(text);
    } catch {
      setFailedScope(chat.scope);
      setDraft(text); // restore — the send failed
    }
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Chat channel"
        className="flex shrink-0 items-stretch gap-1 border-b border-border px-2"
      >
        <ChannelTab
          active={!direct}
          onClick={() => chat.setScope("everyone")}
          ariaLabel={`Everyone${everyoneUnread > 0 ? `, ${everyoneUnread} unread` : ""}`}
        >
          Everyone
          {everyoneUnread > 0 && (
            <UnreadBadge
              count={everyoneUnread}
              className="bg-[color:var(--nexa-accent)] text-[color:var(--nexa-accent-ink)]"
            />
          )}
        </ChannelTab>
        <ChannelTab
          active={direct}
          onClick={() => chat.setScope("dm")}
          ariaLabel={`Direct${directUnreadPeers > 0 ? `, ${directUnreadPeers} unread` : ""}`}
        >
          <Lock className="size-3" aria-hidden="true" />
          Direct
          {directUnreadPeers > 0 && (
            <UnreadBadge
              count={directUnreadPeers}
              className="bg-[color:var(--nexa-accent)] text-[color:var(--nexa-accent-ink)]"
            />
          )}
        </ChannelTab>
      </div>

      {direct && (
        <div className="shrink-0 border-b border-border p-2">
          {people.length === 0 ? (
            <p className="px-1 py-1.5 text-xs text-muted-foreground">
              You&apos;re the only one here — nobody to message privately yet.
            </p>
          ) : (
            <select
              value={chat.peerSessionId ?? ""}
              onChange={(event) =>
                chat.openDirect(event.target.value || null)
              }
              aria-label="Message someone privately"
              className="h-9 w-full rounded-[2px] border border-input bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus:border-[color:var(--nexa-accent)]/60"
            >
              <option value="">Choose someone…</option>
              {people.map((person) => (
                <option key={person.sessionId} value={person.sessionId}>
                  {person.displayName ?? "Guest"} · {person.nexaId}
                  {person.inRoom ? "" : " (left)"}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {chat.messages.length === 0 && (
          <div className="pt-8 text-center text-sm text-muted-foreground">
            {chat.loading
              ? "Loading messages…"
              : direct
                ? "No messages with this person yet."
                : "No messages yet."}
          </div>
        )}
        {chat.messages.map((message) => {
          const mine = message.sessionId === selfSessionId;
          const time = new Date(message.sentAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          // In a thread, your own messages name their addressee.
          const who = mine
            ? direct
              ? `To ${message.toDisplayName ?? peerName}`
              : "You"
            : (message.displayName ?? "Guest");
          return (
            <div
              key={message.id}
              className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
            >
              <div className="mb-1 flex items-baseline gap-2 px-0.5">
                <span className="text-[11px] font-semibold text-foreground">
                  {who}
                </span>
                {!mine && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {message.nexaId}
                  </span>
                )}
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {time}
                </span>
              </div>
              <div
                className={`max-w-[85%] break-words px-3 py-2 text-sm leading-relaxed ${
                  mine
                    ? "border-l-2 border-[color:var(--nexa-accent)] bg-[color:var(--nexa-accent)]/10 text-foreground"
                    : "bg-[color:var(--nexa-ink)]/[0.055] text-foreground"
                }`}
              >
                {message.text}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canSend && (
        <form onSubmit={submit} className="shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-2 border border-input bg-[color:var(--nexa-card)] pl-3 pr-1.5 focus-within:border-[color:var(--nexa-accent)]/60">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={1000}
              placeholder={
                direct ? `Message ${peerName} privately` : "Message the room"
              }
              aria-label={direct ? `Message ${peerName} privately` : "Message the room"}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={!draft.trim() || chat.sending}
              aria-label="Send message"
              className={`inline-flex size-8 shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)] ${
                draft.trim() && !chat.sending
                  ? "bg-[color:var(--nexa-accent)] text-[color:var(--nexa-accent-ink)] hover:brightness-105"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {chat.sending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Send className="size-5" />
              )}
            </button>
          </div>
          {chat.error && failedScope === chat.scope && (
            <p className="mt-2 text-xs text-red-400">{chat.error}</p>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            {direct
              ? `Only you and ${peerName} can read this — the server serves it to nobody else, and deletes it with the room.`
              : "Temporary chat — everyone in the room can read it, and it's erased when the room closes."}
          </p>
        </form>
      )}
    </>
  );
}

function ChannelTab({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Full label including any unread count, for screen readers. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`relative inline-flex items-center gap-1.5 px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)] ${
        active
          ? "text-[color:var(--nexa-ink)]"
          : "text-[color:var(--nexa-ink)]/35 hover:text-[color:var(--nexa-ink)]/70"
      }`}
    >
      {children}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-[2px] bg-[color:var(--nexa-ink)]" />
      )}
    </button>
  );
}
