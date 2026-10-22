# Nexa Meet

**Meet. Talk. Forget.** A privacy-first, web-based video meeting platform for
small teams. Real WebRTC, temporary rooms, anonymous Nexa IDs, no meeting
history.

---

## 1. Project structure

```
src/
  components/
    NexaMark.tsx              # brand mark + wordmark
    GoogleMark.tsx            # official four-colour Google "G" (inline SVG)
    BillingCard.tsx           # Razorpay checkout (order → checkout → verify)
    RequireAuth.tsx           # route guard (preserves returnTo)
    meeting/
      MeetingHeader.tsx       # logo, code + copy link, status
      VideoGrid.tsx           # the participant wall, stage and filmstrip
      VideoTile.tsx           # one participant: video, identity, mic, status
      ControlBar.tsx          # mic / camera / share / people / chat / leave
      SidePanel.tsx           # participants list + temporary chat
      Notices.tsx             # banners and full-screen room states
    ui/                       # shadcn/ui primitives
    landing/
      ui.tsx                  # Reveal / SectionHead / CountUp helpers
      Nav.tsx                 # sticky nav (compact on scroll, mobile menu)
      Hero.tsx                # hero + trust strip, invite-code form
      MeetingWindow.tsx       # interactive product shot (lab demo mode)
      Story.tsx               # problem / "Nexa forgets" flow / security lanes
      Product.tsx             # experience list, adaptive quality, features, positioning
      Demo.tsx                # interactive product demo section
      Closing.tsx             # built-for, pricing preview, FAQ, final CTA, footer
      CustomCursor.tsx        # accent dot + trailing ring (fine pointers only)
      GradientBackdrop.tsx    # drifting color field + grain behind the page
  pages/
    Landing.tsx               # composes the landing: "Meet. Then disappear."
                              #   charcoal theme, real product UI as illustration,
                              #   no fabricated testimonials (built-for instead),
                              #   every claim matches the implementation
    Auth.tsx                  # Google + email OTP + continue-as-guest
    Dashboard.tsx             # workspace: start/join, Nexa ID, billing
    Meeting.tsx               # the room (orchestrates everything)
    NotFound.tsx
  hooks/
    use-local-media.ts        # getUserMedia, mic/cam toggles, screen share
    use-signaling.ts          # outbound send + inbound inbox/consume
    use-peer-mesh.ts          # React binding for PeerManager
    use-room-session.ts       # join / heartbeat / media state / leave
    use-meeting-chat.ts       # temporary chat
    use-auth.ts               # template auth hook
  lib/
    errors.ts                 # safe Convex error extraction
    webrtc/
      peerManager.ts          # all RTCPeerConnection logic (React-free)
      ice.ts                  # ICE server config (STUN default, env override)
      logger.ts               # dev logging that can't leak SDP/PII
  shared/
    constants.ts              # code alphabet, limits, copy, plans (server+client)
    types.ts                  # shared DTOs
  convex/                     # backend (Convex functions)
    schema.ts                 # users, meetings, participants, signals, chat,
                              #   rateLimits, payments
    identity.ts               # Nexa ID minting + display name
    meetings.ts               # create/get/join/heartbeat/setMediaState/leave
    signaling.ts              # inbox/send/consume (SDP + ICE routing)
    chat.ts                   # temporary chat list/send
    cleanup.ts                # privacy sweeper ("Forget")
    crons.ts                  # runs the sweeper every minute
    billing.ts                # Razorpay order + signature verification (actions)
    billingStore.ts           # payment records + billing status (queries/mutations)
    utils.ts                  # auth guards, CSPRNG codes, rate limiting
    auth.ts / auth.config.ts  # Convex Auth providers (template, read-only)
    auth/google.ts            # Google sign-in provider (OIDC, identity only)
    auth/emailOtp.ts          # email code provider (Freebuff gateway)
```

Rule of thumb: **WebRTC logic never touches React** (`peerManager.ts`),
**signalling never touches auth** (both validate separately), and **temporary
meeting tables never mix with persistent account tables**.

## 2. Technologies

| Layer      | Tech |
|------------|------|
| Frontend   | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Framer Motion, React Router 7, sonner |
| Backend    | Convex (database + functions + WebSocket transport), Convex Auth |
| Realtime   | WebRTC (RTCPeerConnection mesh) for media; Convex WebSocket queries/mutations for signalling |
| Payments   | Razorpay Checkout (order API + HMAC signature verification, no SDK) |
| Package mgr| Bun |

## 3. Environment variables

Client (Vite, optional):

| Var | Purpose |
|-----|---------|
| `VITE_CONVEX_URL` | Convex deployment URL (provisioned by the platform) |
| `VITE_ICE_SERVERS` | Optional JSON array of ICE servers. Defaults to public STUN. Add TURN for restrictive NATs: `[{"urls":"turn:turn.example.com:3478","username":"…","credential":"…"}]` |

Convex deployment env (server-side only, set in the Convex dashboard):

| Var | Purpose |
|-----|---------|
| `RAZORPAY_KEY_ID` | Razorpay key id (public by nature, read server-side and handed to checkout) |
| `RAZORPAY_KEY_SECRET` | Razorpay secret — **never** sent to the client |
| `RESEND_API_KEY` | Resend API key used to send meeting invitations. Without it invites are skipped and nothing else changes. |
| `RESEND_EMAIL_FROM` | Sender for meeting invitations, e.g. `Nexa Meet <meetings@nexameet.in>`. Requires the domain verified in Resend; without it, invites fall back to Resend's onboarding address and only reach the account owner. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | The Google OAuth client, used for **both** Google sign-in (§8.1) and the calendar integration (§14). One client serves both: Google matches a request's exact callback URI against the client's registered list, and scopes belong to the request — so sign-in asks for identity and the calendar asks for Calendar, and neither can pick up the other's grant. Without them the sign-in screen offers email/guest only, the settings card says calendar sync isn't configured, and nothing else changes. |
| `CALENDAR_TOKEN_KEY` | 32-byte AES-256-GCM key that encrypts stored calendar credentials (`openssl rand -base64 32`). Required before any calendar can be connected. |
| `CALENDAR_REDIRECT_URI` | Optional override for the OAuth callback; defaults to `<CONVEX_SITE_URL>/oauth/calendar/callback`. |
| `NEXA_SITE_URL` | Public origin for invite links and calendar event contents (defaults to `https://nexameet.in`) |
| existing auth vars | `JWT_PRIVATE_KEY`, JWKS etc. (template). `SITE_URL` is **not read** by this app: post-sign-in destinations are pinned to `https://nexameet.in` in `src/convex/site.ts`, so a deployment value that changes on every deploy cannot send people to a preview host. Harmless if present, safe to delete. |

Without the Razorpay vars the app runs fully; the billing card shows an honest
“checkout not configured” state instead of a dead button.

## 4. Local setup

```bash
bun install
bun convex dev --once     # pushes functions + codegen (use --once in CI/scripts)
bunx tsc -b --noEmit      # typecheck
bun run dev               # vite dev server
```

`bun convex dev` (without `--once`) runs a long-lived watcher for local work.

## 5. Production deployment

1. Deploy the frontend (`bun run build`, serve `dist/` over HTTPS — media
   capture requires a secure context). The template includes a Deno/Hono
   static server (`main.ts`) for this.
2. Deploy Convex functions to a production deployment
   (`bunx convex deploy`) and point `VITE_CONVEX_URL` at it.
3. Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (live-mode keys) in the
   production deployment’s environment.
4. HTTPS/WSS is mandatory end to end: Convex serves WSS automatically; the
   frontend origin must be HTTPS for `getUserMedia`/`getDisplayMedia`.
5. The site is published at `https://nexameet.in`, and every sign-in
   destination is pinned to that origin in `src/convex/site.ts` — no
   `SITE_URL` variable is needed or consulted. Verify the domain in Resend so
   invitation email leaves a sender on it (`RESEND_EMAIL_FROM`); set
   `NEXA_SITE_URL` only if invite links should deliberately point elsewhere.
6. Recommended hardening: add a TURN relay (`VITE_ICE_SERVERS`) and a
   Razorpay webhook to reconcile payments out-of-band.

## 6. Signalling architecture

There is no separate WebSocket server — **Convex’s authenticated WebSocket
connection *is* the signalling channel**:

```
Browser A ──mutation signaling.send──▶ Convex (validates both sessions hold
                                       a live seat, rate-limits, inserts row)
Browser B ◀──reactive query signaling.inbox (rows addressed to my session)──
Browser B ──mutation signaling.consume({ids})──▶ rows deleted
```

- Messages: `offer`, `answer`, `candidate`, `renegotiate`. The server never
  parses SDP semantics — only routing, size limits (128 KB), and authz.
- Delivery is at-least-once; the client keeps a processed-id set, and
  whatever is never consumed expires on the 10-minute sweeper pass.
- Identity always comes from the auth session (`getAuthUserId`), never from
  anything the client claims. A message is only accepted if the sender holds
  a seat in that room, and the inbox only returns rows for the caller’s own
  session.

Lifecycle covered: join → peer discovery (presence query) → offer → answer →
ICE exchange → remote tracks → connection state → leave → cleanup (seat row,
its signals, and per-peer connections all removed).

## 7. WebRTC architecture

- **Topology:** full mesh — one `RTCPeerConnection` per remote session.
- **Role assignment:** deterministic — the lexicographically smaller
  `sessionId` is always the offerer, so offers never collide.
- **Negotiation generations:** every offer increments a per-pair `gen`
  counter; answers echo it; stale SDP from an earlier generation is ignored.
  That makes rebuild races converge instead of cross-wiring.
- **Tracks:** each connection creates one `sendrecv` audio transceiver and
  one `sendrecv` video transceiver up front. Mute, camera on/off, and screen
  share are pure `replaceTrack()` swaps — **no renegotiation** for any user
  action.
- **Screen share:** `getDisplayMedia` → replaces the outgoing video track →
  restoring sends the camera track back (also when the user stops sharing
  from the browser’s own bar).
- **Failure handling:** `disconnected` starts an 8 s grace timer, `failed`
  rebuilds the peer; the offerer re-offers, the answerer sends `renegotiate`;
  rebuilds are rate-limited (1.5 s backoff). A signalling-socket reconnect
  triggers a health pass over all peers.
- **Cleanup:** on leave/unmount every PC has listeners detached, tracks
  stopped, and `close()` called; remote video elements unmount with React;
  ghost seats are swept server-side by heartbeat timeout (75 s).

ICE: Google public STUN by default; add TURN via `VITE_ICE_SERVERS`.
Media is encrypted in transit by WebRTC (DTLS-SRTP). **This is transport
encryption, not application-level E2EE** — see §9.

## 8. Authentication architecture

- Convex Auth with three providers:
  - **Email OTP** — code generated server-side (CSPRNG), 15-minute expiry,
    never returned to the frontend, delivered by the email service; delivery
    failures surface as errors.
  - **Anonymous** — used automatically: *joining or starting a meeting never
    requires signing in*. The room page silently establishes an anonymous
    session, then mints a Nexa ID server-side.
- Sessions are Convex Auth sessions (JWT, stored client-side, validated
  server-side on every function call). The server never trusts client-supplied
  identity.
- Passwords/OTP codes are never sent to the frontend, never logged.
- Rate limits (server-side, ephemeral table): OTP sends, meeting creation
  (6 / 10 min), joins, chat (30 / 10 s), signalling bursts, checkout starts.
- The dashboard and billing require an authenticated session (`RequireAuth`);
  meeting routes do not.

### 8.1 Sign in with Google

Added beside the existing providers — email codes and guest sessions are
unchanged and remain the fallback, and nothing else in the auth stack moved.
The flow is OpenID Connect through Convex Auth and Auth.js's Google provider
(`src/convex/auth/google.ts`), so the protocol work is the library's; what
follows is what this deployment configures.

| Step | What happens |
|---|---|
| 1 | *Continue with Google* calls `auth:signIn` with the Google provider. That is a Convex **action**, so the client secret and the code exchange never reach the browser. |
| 2 | The action hands the browser to `<CONVEX_SITE_URL>/api/auth/signin/google` with a one-time PKCE verifier. That route mints the `state`, `nonce` and PKCE cookies (`HttpOnly`, `Secure`, `SameSite=None` — Google returns cross-site, so a stricter value would drop the cookies the callback needs) and resolves Google's OpenID Connect discovery document. |
| 3 | Google is asked for `openid email profile` only, with `prompt=select_account` and **no** `access_type=offline`: signing in must not mint a refresh token, because then it would have to be stored. |
| 4 | Google returns to `<CONVEX_SITE_URL>/api/auth/callback/google`. Convex Auth compares `state`, `nonce` and PKCE against those cookies, validates the ID token (issuer, audience, signature, nonce — via `oauth4webapi`), and exchanges the code with the client secret **server-side**. |
| 5 | The account is created or found, and the browser is returned to the app with a single-use sign-in code that the client exchanges for an ordinary Convex Auth session — the same JWT/JWKS session email sign-in issues. |

Identity rules:

- The account id is Google's `sub`, never the email address: addresses get
  renamed and reassigned, subjects do not.
- Google's `email_verified` claim is mapped onto the profile's
  `emailVerified` flag, and that flag is what decides whether an address
  counts as proof. Convex Auth would otherwise **assume** any OIDC profile's
  address is verified (`allowDangerousEmailAccountLinking` defaults to
  trusting it), so returning the real claim is what stops an unverified
  address from ever linking anything.
- Linking is then the framework's own rule, and it is deliberately narrow.
  A Google sign-in joins an existing Nexa account only when the profile
  counts as verified **and** exactly one account holds that address with
  `emailVerificationTime` set — which email/OTP sign-in does, having proved
  the address by sending it a code. An address Google has not verified never
  links; an address shared by two or more verified accounts is ambiguous and
  does not link either; and in both of those cases a separate account is
  created instead. An email address on its own is never enough to take over
  an existing account.
- If the browser already holds a session — a guest who joined a meeting and
  is now signing in — Convex Auth attaches the Google account to that
  session's user rather than starting a second identity, so a guest keeps the
  Nexa ID and meetings they already had.
- Authorization is untouched: `users`, Nexa IDs, plans, meeting permissions
  and `RequireAuth` all read the same session they always did.

The screen passes the destination it wants back (`/dashboard`, or the
`returnTo` path) as a same-site path in `redirectTo`; Convex Auth returns the
browser there rather than to the site root.

That destination is resolved in **`src/convex/site.ts`**: the published
origin (`https://nexameet.in`) is a constant, and the requested path is
appended to it. The app deliberately does not read the deployment's
`SITE_URL` here — that value is rewritten on every deploy, which used to
return the browser to a preview host (or to a host that no longer exists).
Only a same-site path is accepted, which is precisely what stops the
endpoint from being usable as an open redirect; anything else falls back to
`/dashboard`.

Failure behaviour: if consent is denied, the state check fails, or the code
exchange fails, the callback returns the browser to the app with **no code
and no error parameter** — the page would otherwise look untouched. The
sign-in screen leaves a session-scoped marker before leaving for Google and,
finding it still set after a return with no session, says the attempt did not
complete. It never falls back to email sign-in on its own, and a failed
attempt can never leave the button stuck loading.

Keep Google Calendar separate: it has its own callback
(`<CONVEX_SITE_URL>/oauth/calendar/callback`), its own scopes and its own
stored grant. Signing in with Google grants nothing beyond identity, and
connecting a calendar signs nobody in.

## 9. Nexa privacy model

**Persistent account data** (`users`, `payments`):
- email (only so the user can sign in), optional display name, Nexa ID,
  anonymous/guest flag;
- payment records (financial regulations require them).

**Temporary meeting data** (`meetings`, `participants`, `signals`,
`chatMessages`): exists only while a room is alive. When the last participant
leaves, a 5-minute grace period runs, then the sweeper (`cleanup.stale`, every
minute) deletes the roster, all signals, all chat, marks the room inactive,
and drops the meeting row itself after 10 minutes. No meeting history,
participant history, chat logs, recordings, or conversation analytics are
kept — by construction, not by policy promise.

**Sweeper also handles:** ghost seats (no heartbeat for 75 s), expired
signals (10 min), expired rate-limit counters, old chat in long-lived rooms.

**Claims we make, precisely:**
- Media travels peer-to-peer, encrypted in transit with DTLS-SRTP by the
  browser.
- Signalling and auth run over WSS/TLS.
- Nexa Meet is *privacy-first, not anonymous infrastructure*: while a room is
  open the server knows which account holds each seat, and it routes
  connection metadata. It never receives audio or video.
- **No application-level E2EE is implemented**, and we don’t claim any. The
  media pipeline is isolated from the UI (`peerManager.ts`) so insertable
  streams / SFrame can be added later without a rewrite.

## 10. Plans and limits

Three plans, defined once in `src/shared/constants.ts` (`PLANS`) and enforced
server-side from the room **host's** plan — resolved live on every join and
heartbeat (`getHostPlan` in `src/convex/utils.ts`):

| Plan | Price | Participants per room | Meeting length |
|------|-------|----------------------:|---------------:|
| Free | ₹0 | 15 | 2 hours |
| Business | ₹299 / month | 100 | 8 hours |
| Enterprise | Custom (contact sales) | Unlimited | Unlimited |

- The meeting-length clock starts when the **first seat is taken**
  (`meetings.startedAt`), not when the room code is created.
- Business entitlement = the account's most recent `payments` row marked
  `paid` within the 30-day billing period. It is resolved on every check, so
  an upgrade takes effect mid-room rather than only in the next meeting.
- At the participant limit, joins are rejected with a clear “meeting is
  full” message. At the time limit, seated clients get a “Time limit
  reached” screen and the per-minute sweeper destroys the room state.
- Enterprise is not self-serve: the landing page's *Contact sales* button
  opens a mailto to `SUPPORT_EMAIL` in `src/shared/constants.ts` — the one
  place to change the public inbox.
- Checkout (Business) is the only paid path: Razorpay order → payment →
  HMAC-verified signature → `payments.status = "paid"`.

## 11. Meeting interface

The room is a studio rather than an app window: no ribbon across the top, no
toolbar across the bottom, and no grid of rounded cards. Three pieces of
furniture carry it — a vertical **instrument spine** down the left edge, a
typeset **masthead** across the top, and an edge-to-edge **wall** of video
plates.

- **Pre-join:** camera preview (mirrored, resolution chip), camera selector,
  mirror toggle, mic input meter, mic selector, speaker test, noise tier,
  and an Effects dialog — all before a seat is taken. Permission failures
  show a precise error row with Retry, never a black rectangle.
- **The wall:** each participant is a square plate set flush into a
  continuous surface, divided by hairline joints and a single inset edge.
  Every plate carries one strip of bone paper on its bottom edge — name,
  Nexa ID where there is room, mic state. The strip prints on signal lime
  for the voice the room is hearing, with a three-bar meter; nothing else
  about the plate changes. No rounded cards, frame numbers, glowing rings,
  glass or translucent name chips.
- **Dynamic layouts:** rows are built explicitly, so a full row stays equal
  and the last row stretches instead of leaving a hole (five people read as
  three over two; seven as four over three). Presenting or pinning collapses
  the wall to a stage with a horizontal filmstrip beneath it (instead of the
  usual right-hand thumbnail rail); Spotlight removes the filmstrip. One
  participant gets the wall to themselves, with the self-view floating.
- **Video effects** (`src/lib/effects/videoEffects.ts`): off / background
  blur / virtual background (presets or uploaded image) plus brightness,
  contrast, saturation. Processed frames flow through the **existing outgoing
  track via `replaceTrack`** — switching effects never renegotiates or
  rebuilds the WebRTC connection. The processor degrades stepwise (lower
  scale → lower fps) under load, shows a one-time notice, and falls back to
  the raw camera instead of going black. Background replacement uses
  MediaPipe selfie segmentation loaded lazily from CDN; if it can't load,
  the mode is disabled with an explanation.
- **Microphone:** noise cancellation tiers OFF / STANDARD (default) / STRONG
  mapped to browser-native constraint processing (no fake “AI” claims),
  input level meter, strong-mic chain (highpass + compressor) when active,
  and device switching that updates the meter immediately.
- **Speaker test:** generated two-note chime with output-device selection
  via `setSinkId` where supported.
- **The spine:** brand and the live mic fader at the top, then split device
  keys (the face toggles, the caption row with its chevron opens devices and
  noise), screen sharing, people / chat / notes, reactions, and a More menu
  (composition, self-view, effects, audio, video, shortcuts, fullscreen,
  PiP, report a problem). The leave key sits alone at the floor of the rail.
  **Every key carries its name underneath** — `Mic`, `Muted`, `Camera`,
  `Camera off`, `Present`, `People`, `Chat`, `Notes`, `React`, `More`,
  `Leave` —
  so a first-time user never has to decode an icon or find a hover. A closed
  device is dark red and says so; an open tool reads as pressed paper with a
  lime label; hover adds the keyboard shortcut. Menus open beside the rail
  on desktop and as a fixed sheet on phones, so a short window never clips
  them. Shortcuts:
  `M` mute, `V` camera, `S` share, `C` chat, `P` people, `E` effects,
  `Esc` close — suppressed while typing in a text field.
- **Reactions:** 👍 😂 ❤️ 👏 🎉 😮 🔥 float subtly with a 350 ms rate limit,
  transported as short ephemeral `reaction` signals and swept with the room.
- **Self-view:** a floating plate docked bottom-right (clear of every
  gallery label), draggable, mirrorable, or pinned onto the wall; hiding it
  is reversible from the More menu, and it follows the stage during screen
  share.
- **Fullscreen & PiP:** one fullscreen concept — the studio, spine and
  masthead included — reachable from the masthead button, any plate's hover
  key, or the More menu, so the controls are never left behind on a bare
  video. Escape exits cleanly. Picture-in-Picture with auto-PiP on tab hide
  when the preference is on and the browser supports it.
- **Settings panel:** Audio, Video, Appearance, Accessibility, Privacy
  sections — including a shortcuts reference and an honest note that live
  captions are **not** implemented in this build (no fake caption feature).
- **Accessibility:** every rail key has a visible name plus an `aria-label`,
  visible focus rings, hover tips that add the shortcut, Escape-to-close
  panels, a tab order that starts at the spine (it is the first node in the
  DOM, not merely first on screen), and reduced-motion support throughout
  (framer animations collapse to fades).

## 12. Known limitations

1. **Mesh scaling** — one upload stream per participant. Plan caps are 15
   (Free) and 100 (Business), but peer-to-peer mesh degrades well before
   the higher cap: roughly 6–10 comfortable streams per client on typical
   connections. Reliable large rooms need an SFU (media server).
2. **No TURN by default** — some symmetric-NAT/symmetric-firewall pairs will
   fail to connect until a TURN server is configured (`VITE_ICE_SERVERS`).
3. **Razorpay unverified in this environment** — the order → checkout →
   signature-verification flow is implemented and type-checked, but no live
   keys exist here, so it has not been exercised end-to-end. Without keys the
   UI shows the honest “not configured” state. No webhook reconciliation yet.
4. **OTP rate limiting is window-based per email**, not per IP, and relies on
   the deployment’s email provider for delivery latency.
5. **Automatic cleanup granularity is 1 minute** (cron) — an empty room
   closes up to ~1 minute after its grace period.
6. **Chat is capped at the last 100 messages per client view**, deleted with
   the room.
7. Two-way audio/video still needs a real two-browser pass (procedure below)
   on the deployed environment — this build has been verified by typecheck,
   codegen and code review, not by live media testing here.
8. **Google Calendar sync has not been exercised against a real Google
   account** in this environment (no OAuth client or consent here). The whole
   flow — state validation, code exchange, token refresh, event create/patch/
   delete, retries — is covered by tests against a *simulated* Google that
   implements its conflict and error behaviour, and the callback route is
   live on the deployment. Treat the first real connection as a test run and
   follow the checklist in §14.
9. **The Google OAuth app must be verified for production use.**
   `calendar.events.owned` is a sensitive scope: while the Cloud project is
   in *Testing*, only listed test users (max 100) can connect **and their
   refresh tokens expire after 7 days**, which shows up as users being asked
   to reconnect weekly. Publish the app (and complete verification) before
   relying on it, or expect the `needs_reauth` state.
10. **Deleting an event in Google does not delete the Nexa booking**, and
    cancelling in Nexa does not notify anyone Nexa never emailed: it removes
    the calendar event (so Google tells guests) and closes the invite link.
11. **Mesh, TURN and multi-device behaviour are unchanged by this feature** —
    the calendar integration adds no media path, and scheduling works with the
    calendar disconnected.
12. **Google sign-in is verified up to Google's door, not through it.** The
    handoff, the checks, the scopes, the callback URL and the authorization
    request this deployment builds have all been exercised here — including a
    run that really resolved Google's discovery document and asserted the
    request it produced — but completing a sign-in needs a real Google account
    and a consent screen. Do §14.4 first, then treat the first real sign-in as
    a test run; nothing here claims production sign-in works until that pass
    has happened. (`SITE_URL` on the deployment was corrected to
    `https://nexameet.in` on 2026-10-15. While it pointed at the deployment's
    own `.convex.site` host, the callback returned the browser to
    `<deployment>.convex.site/dashboard` — a host that serves HTTP routes, not
    the app — and sign-in ended at "No matching routes found" (§8.1); the
    cancelled/failed-return behaviour described in §8 was confirmed against
    the live deployment at the same time. That variable is no longer read at
    all: redirects are pinned in `src/convex/site.ts`, so a deploy that
    rewrites it cannot reproduce the fault.)

## 13. Exact two-browser testing procedure

> Use two *separate* browser sessions (normal window + private window, or two
> profiles). Use headphones on at least one machine to avoid feedback.

1. **Create (browser A):** open the site → *Start a meeting* → allow camera
   and microphone → you land in the room. Copy the link from the header.
2. **Join (browser B):** open the invite link → allow media → you appear in
   A’s grid. Verify: A sees B, B sees A.
3. **AUDIO TEST (most important), both directions independently:**
   - A speaks; confirm B hears A (B’s mic muted so there’s no ambiguity).
   - B speaks; confirm A hears B (A’s mic muted).
   - Unmute both: conversation flows both ways with no echo loops.
4. **Mute/unmute:** A mutes → B sees “Muted” in the tile and People panel and
   hears nothing; A’s browser mic indicator turns off. Unmute restores audio.
5. **Camera on/off:** A camera off → placeholder monogram on B, indicator off;
   on again → video returns (no reload).
6. **Screen share:** A shares a window → B sees it, A shows “You’re
   presenting”; stop from Nexa *and* from the browser bar → camera returns.
7. **Notifications:** B joins/leaves → A sees a subtle “NX-… joined/left”
   toast (never a persistent history).
8. **Chat:** send messages both ways; refresh after the room closes → messages
   are gone.
9. **Leave/rejoin:** A leaves, rejoins with the same link (B still inside) →
   works. Leave with B gone → wait past the grace window → link shows
   “This meeting doesn't exist or has ended.”
10. **Network drop:** disable Wi‑Fi on B for ~15 s → A shows reconnecting,
    B shows “Connection lost. Reconnecting…”; restore → peers recover or
    rebuild automatically.
11. **Permission denial:** block camera/mic in the browser → precise banner
    (“Camera access was blocked…”) with Retry, room still usable.
12. **Invalid code:** open `/m/AAAAAAAAAAAAAAAA` → clean “Meeting
    unavailable” screen, no blank page.
13. **Auth:** sign in with email OTP (code arrives, expires in 15 min);
    guest path requires no email at all.
14. **Dashboard/billing:** set Razorpay keys → *Continue to payment* opens
    Checkout; a test-mode payment verifies server-side and flips the plan to
    active with a receipt row.
15. **Mobile layout:** repeat steps 1–7 on a phone browser — the wall stacks,
    the spine stays scrollable with its menus as fixed sheets, and the clock
    condenses to the two readings.

## 14. Google Calendar integration

Scheduling a meeting can mirror it into the organiser's own Google Calendar:
Nexa creates the event, puts the join link in it, and lets Google send the
invitations to any guests. Microsoft Outlook is intended next — the design is
provider-independent on purpose, and adding Graph means writing one adapter and
one registry line.

The meeting experience never depends on the calendar. Booking works with no
calendar connected, the booking is written **before** any calendar call, and a
failing calendar is reported honestly with a retry — it never loses or
duplicates a meeting.

### 14.1 Architecture

| Concern | File |
|---|---|
| Provider contract + failure taxonomy | `src/convex/calendar/providers/types.ts` |
| Google adapter (URLs, scopes, requests, status → failure mapping) | `src/convex/calendar/providers/google.ts` |
| Provider registry (the only place that knows what exists) | `src/convex/calendar/providers/registry.ts` |
| Connections: consent URL, status, disconnect, token refresh | `src/convex/calendar/connections.ts` |
| Sync: idempotent create/update/cancel, retry ladder, reconciler | `src/convex/calendar/sync.ts` |
| OAuth callback + readiness probe (HTTP routes) | `src/convex/calendar/http.ts`, `src/convex/http.ts` |
| AES-256-GCM credential sealing, PKCE/state helpers | `src/convex/calendar/secrets.ts` |
| Origin, redirect URI, open-redirect guard, env readiness | `src/convex/calendar/config.ts` |
| Meeting records, duration, reschedule | `src/convex/schedule.ts` |
| Timezone maths (shared by server and browser) | `src/shared/time.ts` |
| UI: connection card, scheduling, reschedule dialog | `src/components/calendar/*`, `src/components/ScheduleCard.tsx` |

Adding a provider = one adapter implementing `CalendarProvider`, one entry in
`providers/registry.ts`, and one label in `CALENDAR.providerLabel`. The schema
stores `provider` as a string, the sync service reads it from the row, and the
UI maps over the providers the server reports.

### 14.2 Data model

Three tables, added to `src/convex/schema.ts`:

- **`calendarConnections`** — one OAuth grant per (account, provider). Holds the
  encrypted access/refresh tokens, the granted scopes, the calendar to write to
  (`primary`), and connection status: `connected | needs_reauth | revoked`.
- **`calendarOAuthStates`** — single-use, 10-minute CSRF state for a connect
  flow. Stores only `sha256(state)`, plus the PKCE verifier *encrypted*, and the
  validated return path.
- **`calendarEvents`** — the mapping: Nexa meeting → provider event, with the
  desired state (title, times, zone, guests, join link, cancelled), the
  provider event id, sync status (`pending | synced | failed | cancelled`),
  attempt count, next attempt time and last error.

Timestamps are UTC epoch milliseconds with the IANA zone kept beside them.
`src/shared/time.ts` converts an instant to a provider datetime (with the zone's
real offset at that instant) and back, which is what makes daylight-saving
boundaries come out right in both directions.

### 14.3 How a sync stays idempotent

The design is deliberately declarative: a `calendarEvents` row stores what the
event *should* be, and every attempt applies that snapshot from scratch.

1. **We choose the event id** (`randomBase32Hex`, 160 bits) before creating
   anything and reuse it forever. Google accepts a caller-supplied id in
   base32hex, so a create whose response was lost gets **409 duplicate** on the
   retry — which is treated as *already created*, then confirmed with a GET.
2. **Rescheduling PATCHes the same id**, so applying it twice is a no-op.
3. **Cancelling deletes that id**; a 404/410 is a success, so a repeated cancel
   cannot error or resurrect the event.
4. **An event deleted in Google is recreated** on the next sync instead of
   failing forever.

Failures are classified by the adapter into `transient`, `rate_limited`,
`reauth_required`, `permanent` or `not_found`, and each is handled differently:

transient/rate-limited → `pending`, a backoff (15s, 1m, 5m, 15m, 1h, 3h, 6h,
12h) and a `scheduler.runAfter` retry; at 8 attempts it stops as `failed` and
says so. Rejected grant → the connection becomes `needs_reauth` and the UI asks
the user to reconnect. Permanent (e.g. a 403 refusal) → `failed`, no blind
retries. The attempt takes a 60-second lease in `nextAttemptAt`, so an action
that dies mid-flight is picked up by the reconciler cron (`crons.ts`, every 5
minutes) rather than being silently forgotten.

### 14.4 Google Cloud setup

1. Create (or pick) a project at <https://console.cloud.google.com>.
2. **Enable the API:** APIs & Services → Library → *Google Calendar API* →
   Enable.
3. **OAuth consent screen** (Google Auth Platform → Branding/Audience):
   - User type **External** (or Internal for a Workspace-only deployment).
   - App name, support email, developer contact.
   - While in **Testing**, add every Google account that will connect as a
     *test user* (limit 100). Note the 7-day refresh-token expiry — see
     §14.7.
4. **Scopes** (Google Auth Platform → Data Access → Add or remove scopes):
   - `https://www.googleapis.com/auth/calendar.events.owned`
   - `openid`, `email`, `profile`

   `calendar.events.owned` is *"See, create, change, and delete events on
   Google calendars you own"* — the narrowest Calendar scope that permits
   creating, updating and deleting an event. Nexa deliberately does **not**
   request `calendar.events` (every calendar the user can see) or `calendar`
   (which also covers sharing and settings), and never asks for full-calendar
   read access. `openid`, `email` and `profile` are the identity scopes §8.1
   signs in with, and they are also why the calendar card can name *which*
   account is connected.
5. **Credentials** → Create credentials → OAuth client ID → **Web
   application**. Add **Authorized redirect URIs**, one per deployment and one
   per flow:

   ```
   # Calendar integration (§14)
   https://<your-dev-deployment>.convex.site/oauth/calendar/callback
   https://<your-prod-deployment>.convex.site/oauth/calendar/callback
   # Google sign-in (§8.1)
   https://<your-dev-deployment>.convex.site/api/auth/callback/google
   https://<your-prod-deployment>.convex.site/api/auth/callback/google
   ```

   Both paths are served by the Convex deployment (not the web origin), so
   authorization codes are always exchanged server-to-server. You can read the
   exact calendar URI a deployment expects from its readiness probe — see
   §14.6.

   **One OAuth client is enough for both flows, and that is not a
   compromise.** Google matches a request's `redirect_uri` *exactly* against
   this list, and the scopes that matter are the ones each authorization
   request asks for — not the ones the client is capable of. So sign-in asks
   for identity only, the calendar asks for `calendar.events.owned`, and the
   two grants are separate tokens stored (or not stored) separately. Register
   only the **callback** URIs above: the `/api/auth/signin/google` hop never
   appears to Google as a redirect target.

   Since the same consent screen gates both, publishing the app resolves the
   *Testing* caveats for sign-in and the calendar at once — see §14.7. Note
   that `openid`, `email` and `profile` are non-sensitive and never require
   verification; the 7-day refresh-token expiry in *Testing* bites the
   Calendar grant, which stores a refresh token, and not sign-in, which asks
   for none.
6. Copy the client ID and secret into the Convex environment (§14.5).

### 14.5 Environment variables

All of these are **server-side**: set them in the Convex deployment's
environment (dashboard.convex.dev → Settings → Environment Variables, or
`npx convex env set NAME value`). None of them belong in the Vite bundle.

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | OAuth client id |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret (never leaves the server) |
| `CALENDAR_TOKEN_KEY` | yes | AES-256-GCM key for stored credentials — `openssl rand -base64 32` (base64, base64url or hex; must be 32 bytes). If a shell or dashboard mangles `+`/`/`, use `openssl rand -hex 32` instead |
| `CALENDAR_REDIRECT_URI` | no | Overrides the callback URL when it is fronted by a proxy/custom domain; must match Google exactly |
| `NEXA_SITE_URL` | no | Public origin for invite links and event contents (default `https://nexameet.in`) |
| `CONVEX_SITE_URL` | yes (already set) | Both callbacks (calendar and sign-in) are derived from it |

`.env.example` itself is managed by the platform and cannot be edited from the
builder, so the same placeholders live in **`env.calendar.example`** at the
repository root. They are repeated here so this file stays self-contained —
paste placeholders only:

```
# --- Google Calendar integration (Convex environment) ---
GOOGLE_CLIENT_ID=000000000000-example.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=replace-me-with-the-client-secret
CALENDAR_TOKEN_KEY=replace-me-with-32-random-bytes   # openssl rand -base64 32
CALENDAR_REDIRECT_URI=                                # optional override
NEXA_SITE_URL=                                        # optional, defaults to https://nexameet.in

# --- Meeting invitation email (Convex environment) ---
RESEND_API_KEY=re_replace_me
RESEND_EMAIL_FROM=                                    # e.g. Nexa Meet <meetings@nexameet.in>
```

Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` the settings card says the
integration isn't configured and everything else keeps working. Without
`CALENDAR_TOKEN_KEY` the same is true, because credentials must not be stored
unencrypted.

### 14.6 Local development and readiness

```bash
bunx convex env set GOOGLE_CLIENT_ID    000000000000-example.apps.googleusercontent.com
bunx convex env set GOOGLE_CLIENT_SECRET <secret>
bunx convex env set CALENDAR_TOKEN_KEY  "$(openssl rand -base64 32)"
curl -s https://<your-deployment>.convex.site/calendar/status | jq
```

The `/calendar/status` route reports only *whether* the environment is wired
(and the exact redirect URI to register), never a value. Add its
`oauth/calendar/callback` URL to the Google client's authorized redirect URIs
before clicking Connect.

### 14.7 Production requirements

- Both deployments (dev and prod) need their own redirect URI registered, and
  each needs its own environment variables.
- `calendar.events.owned` is a **sensitive** scope, so a public app must
  complete Google's OAuth verification (scope justification, a demo video, and
  a privacy policy on the app's domain) or stay in *Testing*. While in
  *Testing*, only listed test users can connect **and their refresh tokens
  expire after 7 days** — which Nexa reports as `needs_reauth` and asks the
  user to reconnect. Verification is not required for a Workspace-internal app
  used only by your own organisation.
- Sensitive scopes do not require a restricted-scope security assessment
  (that is for restricted data such as Gmail). See
  <https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification>
  and <https://developers.google.com/workspace/calendar/api/auth>.

### 14.8 Privacy and security

- **Minimum scope.** Only the narrowest Calendar scope that can create and
  manage events, plus basic identity for display. No full-calendar read, no
  calendar list, no sharing rights.
- **Encrypted at rest.** Access and refresh tokens are sealed with AES-256-GCM
  under `CALENDAR_TOKEN_KEY` and stored as `v1.<iv>.<ciphertext>`; the key lives
  only in the deployment environment. Decryption happens inside actions and the
  callback, never in a query.
- **Never exposed.** No query selects a token column: the settings query maps
  field by field, `listLinks` returns only sync state, and the callback puts a
  result flag (`connected`, `error&reason=…`) in the redirect URL and nothing
  else.
- **Never logged.** The callback logs a failure classification, not the code,
  verifier or tokens; guest addresses appear only in the requests to Google.
- **CSRF and open redirects.** The connect flow issues a 256-bit single-use
  state, stores only its hash, expires it after 10 minutes, and consumes it
  atomically so a replay fails. Plus PKCE (S256) with the verifier encrypted
  server-side. The callback only ever redirects to a *path* on `NEXA_SITE_URL`;
  absolute and protocol-relative `returnTo` values are discarded.
- **Authorization on every operation.** Create, reschedule, sync and cancel all
  resolve the caller's own booking server-side; a stranger supplying someone
  else's code gets the same "no such meeting" as an invented code.
- **Rate limits.** Connect flows, reschedules and syncs are rate limited per
  account, on top of Google's own quota handling (403 quota/rate responses are
  retried with backoff).
- **Guest copies.** Google Calendar and every invitee keep their own copy of
  the event — that is inherent to calendar invitations, and the settings card
  says so.

### 14.9 Who may connect a calendar

A connection belongs to an **account**, and it exists to carry the events that
account books — so the right to connect is exactly the rule `schedule.schedule`
enforces: a real account with an email address.

- A **guest** session (the `Anonymous` provider behind joining a meeting and
  *Start a room*) has an id but no account behind it. `startConnect` refuses it
  with `CALENDAR.guestNeedsSignIn`, and `status` answers with
  `requiresSignIn: true` and an empty provider list. A guest therefore never
  sees a *Connect* button, and never sees a *Connected* state — the two cards
  on `/dashboard` can no longer contradict each other.
- An account **without an email** is treated identically, for the same reason:
  it cannot book anything, so a grant attached to it could never receive an
  event.
- `status` filters the *report*, not the row: a grant created before this rule
  existed stays in the database untouched, it is simply not reported to a guest.
  Signing in produces a real account, and the calendar is connected again from
  there. The old guest grant is deliberately **not** inherited — a guest id is
  not evidence that the account behind it is the same person.

The card asks for the sign-in itself: when `requiresSignIn` is true it renders
one line of copy and a *Sign in* link to `/auth?returnTo=/dashboard`, instead of
the provider list.

### 14.10 Disconnecting

Disconnect is in the settings card and asks for confirmation first. It:

1. asks Google to **revoke** the grant (so the access really ends, not just
   locally);
2. deletes the sealed tokens from the database and marks the connection
   `revoked`;
3. stops any sync still waiting, with `Reconnect the calendar` rather than a
   silent failure;
4. **leaves events already created in the calendar alone** — they are the
   user's, and Nexa simply stops updating or deleting them. Reconnecting and
   pressing Retry resumes managing the same events (no duplicates).

### 14.11 Tests

```bash
bunx vitest run src/convex/calendar/calendar.test.ts   # integration, mocked Google
bunx vitest run src/shared/time.test.ts                # timezone + DST + form round trip
bunx vitest run                                        # everything
```

The integration suite runs against a real Convex backend (`convex-test`) with
`fetch` stubbed by a stateful fake Google that implements idempotency and error
behaviour properly: duplicate ids return **409**, deletes of missing events
return **410**, and a `status: 503` genuinely does *not* take effect while an
`afterNetwork` failure commits and then loses the response. It covers OAuth
state validation and replay, the open-redirect guard, token sealing and refresh,
expired and revoked credentials, event create/patch/delete, retries and the
attempt limit, the reconciler, cross-account authorization, who may connect at
all (a guest is refused before any state is written, and is told no calendar is
connected even if one exists), disconnect and reconnect, and that no query leaks
a credential.

### 14.12 Manual end-to-end checklist (real Google account)

1. Sign in with an email address (or Google) — a guest session cannot connect a
   calendar (§14.9). The card shows a *Sign in* line instead of a *Connect*
   button until you do.
2. Set the three environment variables, add the redirect URI in Google Cloud,
   and open `/calendar/status` — `configured` and `tokenKeyConfigured` must both
   be `true` and `redirectUri` must match what you registered.
3. Go to `/dashboard` → **Calendars** → *Connect Google Calendar*. The
   consent screen must show only *Create, change and delete events on calendars
   you own* (plus basic profile); approve it.
4. You land back on `/dashboard` with "Calendar connected." and the card shows
   the Google address you chose.
5. Schedule a meeting 10 minutes out with one guest, keeping *Add to Google
   Calendar* ticked. The toast confirms; the row shows **On your calendar** and
   the external-link icon opens the real event with the join link in it.
6. Open the guest's inbox: the Google invitation arrives *from your own
   calendar*, and the Nexa invitation email arrives separately.
7. Reschedule it from the row's pencil → click the event link again. The event
   moved; there is **exactly one** event in Google Calendar.
8. Disconnect in the settings card, then schedule and retry a sync → the card
   and the row both say the calendar needs reconnecting.
9. Reconnect, press **Retry** on the row → the same event is picked up again
   (still one event).
10. Cancel the meeting → the event disappears from Google Calendar and the guest
   gets Google's cancellation; the invite link stops working.
11. Delete an event directly in Google Calendar, then press **Add to calendar**
    on the Nexa row → it is recreated.
12. In Google's *Third-party access* page, remove Nexa's access, then retry a
    sync → Nexa reports that reconnection is needed instead of retrying
    forever.

### 14.13 Troubleshooting

| Symptom | Cause / fix |
|---|---|
| The card asks you to sign in although you connected a calendar earlier | That grant was created from a **guest** session, which cannot own one; the guest id is not inherited by a real account, so sign in and connect once more (§14.9) |
| Card says calendar sync isn't configured | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` missing on the **Convex** deployment |
| **Continue with Google** fails at once with "could not start" | The same two variables are missing (or the deployment has not picked them up yet) — email and guest sign-in still work |
| Google answers `redirect_uri_mismatch` when signing in | `<CONVEX_SITE_URL>/api/auth/callback/google` is not in that client's authorized redirect URIs (§14.4) |
| Back on the sign-in screen with "didn't complete" | Consent was denied, or a `state`/`nonce`/PKCE check failed. Attempts are single-use and expire, so start again — nothing was linked |
| Google blocks sign-in for some people only | The consent screen is in *Testing*: add the account as a test user, or publish the app (§14.7) |
| After consenting, the browser lands on a 404 at `<deployment>.convex.site` | Only possible on an older build: post-sign-in destinations are pinned to `https://nexameet.in` in `src/convex/site.ts` now (§8.1). Redeploy the Convex functions |
| Card says credentials can't be stored | `CALENDAR_TOKEN_KEY` missing or not 32 bytes |
| `redirect_uri_mismatch` from Google | The URI registered doesn't exactly match `/calendar/status`'s `redirectUri` for that deployment |
| Callback lands with "that link expired" | The state was already used or is older than 10 minutes — start again |
| Row stuck on **Syncing…** | Transient Google failure: Nexa retries on its own (15s → 12h); the reconciler cron re-arms anything overdue |
| Row shows **Reconnect needed** | The grant was revoked or (in *Testing* status) the refresh token expired after 7 days |
| 403 `forbidden` from Google | The consent screen is missing a scope, or the user's Workspace admin blocked the app |
| Nothing in Google Calendar but the row is green | You're looking at a different calendar — Nexa writes to `primary` of the connected account |
