import { LegalPage, LegalSection } from "@/components/LegalPage";
import { useSeo } from "@/hooks/use-seo";
import { breadcrumbList, type SeoConfig } from "@/lib/seo";
import { SUPPORT_EMAIL } from "@/shared/constants";

/**
 * Privacy Policy for Nexa Meet.
 *
 * Every claim on this page maps to an actual behaviour of the implementation:
 * peer-to-peer media, sweeper-deleted room state, no recording feature, Google
 * sign-in that stores no tokens, Google Calendar tokens sealed with
 * AES-256-GCM under a deployment-only key, and exactly four processors. If any
 * of that changes, change this page in the same commit — the Google API
 * Services User Data Policy requires the disclosure to stay accurate.
 */

/** The exact Google OAuth scopes this deployment requests. Kept in sync with
 *  `src/convex/auth/google.ts` (sign-in) and
 *  `src/convex/calendar/providers/google.ts` (calendar). */
const SIGN_IN_SCOPES = "openid email profile";
const CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
];

function Scope({ children }: { children: string }) {
  return (
    <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </code>
  );
}

const PRIVACY_SEO: SeoConfig = {
  title: "Privacy Policy — Nexa Meet",
  description:
    "What Nexa Meet does with your data: peer-to-peer media, temporary room state deleted by a sweeper, no recording, and the four processors involved.",
  path: "/privacy",
  jsonLd: [breadcrumbList("Privacy Policy", "/privacy")],
};

export default function Privacy() {
  useSeo(PRIVACY_SEO);
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated="17 October 2026"
    >
      <LegalSection n={1} title="Who we are and what this covers">
        <p>
          Nexa Meet (&quot;Nexa&quot;, &quot;we&quot;, &quot;us&quot;) is a
          browser-based video meeting service operated at{" "}
          <a
            href="https://www.nexameet.in"
            className="text-foreground underline underline-offset-2"
          >
            www.nexameet.in
          </a>
          . This policy is published on that domain and applies to the Nexa Meet
          web app and the Nexa Meet desktop application.
        </p>
        <p>
          It explains how we handle personal data generally, and — in the
          sections below — exactly how we access, use, store, and share
          information obtained from Google when you sign in with Google or
          connect a Google Calendar. This policy is linked from our public
          homepage and from inside the signed-in application.
        </p>
      </LegalSection>

      <LegalSection n={2} title="Google Sign-In">
        <p>
          You can sign in to Nexa with a Google Account. When you do, Google
          asks your permission for three things and nothing more:
        </p>
        <p>
          <Scope>{SIGN_IN_SCOPES}</Scope>
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="font-medium text-foreground">
              What we receive.
            </span>{" "}
            Your Google account identifier, name, email address, profile picture
            URL, and Google&apos;s verified/email flag. That is the whole of it.
          </li>
          <li>
            <span className="font-medium text-foreground">Why we use it.</span>{" "}
            To create your Nexa account, sign you in, and show your name and
            picture next to your account inside the dashboard. We do not use it
            for advertising and we do not build a profile from it.
          </li>
          <li>
            <span className="font-medium text-foreground">Where it is stored.</span>{" "}
            In your account record in our database (hosted by Convex — see
            section&nbsp;7), as your email, name, picture URL, and email-verified
            status. This is the same record an email-sign-in account uses.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Whether we hold Google credentials.
            </span>{" "}
            No. Signing in asks Google for identity only and deliberately
            requests no offline access, so no Google access or refresh token is
            issued or stored for sign-in. Signing in with Google grants Nexa
            nothing from Calendar, Drive, or Gmail.
          </li>
        </ul>
        <p>
          Sign-in and Calendar are separate grants. Signing in with Google never
          requests calendar permission, and connecting a calendar never signs
          anybody in.
        </p>
      </LegalSection>

      <LegalSection n={3} title="Google Calendar (optional connection)">
        <p>
          If you choose to connect Google Calendar from your dashboard, you
          grant Nexa a separate OAuth permission. This is optional and only
          available to signed-in accounts (a guest session has no account to
          attach a calendar to).
        </p>
        <p>
          <span className="font-medium text-foreground">
            The exact scopes we request
          </span>{" "}
          are:
        </p>
        <ul className="space-y-1.5">
          {CALENDAR_SCOPES.map((scope) => (
            <li key={scope}>
              <Scope>{scope}</Scope>
            </li>
          ))}
        </ul>
        <p>
          <Scope>calendar.events.owned</Scope> is Google&apos;s description
          &quot;See, create, change, and delete events on Google calendars you
          own.&quot; We request it rather than a broader scope on purpose: it is
          the narrowest Calendar scope that lets us create and manage the events
          you schedule in Nexa. We do not request <Scope>calendar.events</Scope>{" "}
          (which would include every calendar you can just see) or{" "}
          <Scope>calendar</Scope> (which can also change sharing and settings).
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="font-medium text-foreground">
              What we access and do.
            </span>{" "}
            For each meeting you schedule in Nexa with a calendar connected, we
            create one event on your primary Google calendar (POST), update it
            when you change the booking (PATCH), delete it when you cancel
            (DELETE), and read that one event back (GET, limited to its id,
            link, organizer, and start/end fields) to confirm or reconcile it.
            Google sends the invitations to the guests you added, from your own
            calendar, which is why we pass the guest addresses you entered.
          </li>
          <li>
            <span className="font-medium text-foreground">
              What we do not access.
            </span>{" "}
            We never read your other calendar events or your calendar list, and
            we do not search your calendar. Every request is for one event we
            created, on the primary calendar.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Whether event content is stored in our database.
            </span>{" "}
            Yes, but only the event details Nexa itself created: the title, the
            start and end time, the time zone, the guest addresses you entered,
            the Nexa join link, and a cancellation flag. We also store the Google
            event id and its link, so a retry reconciles with the existing event
            instead of creating a duplicate. We do not store Google&apos;s copy
            of the event, its description, attachments, or any other content
            from your calendar.
          </li>
          <li>
            <span className="font-medium text-foreground">
              How long we keep it.
            </span>{" "}
            The connection and its tokens are kept until you disconnect or
            revoke them, or delete your account. The event mapping stays while
            the booking does and is what lets a cancel remove the event; it is
            deleted along with your account data on request.
          </li>
        </ul>
      </LegalSection>

      ```
      <LegalSection n={4} title="Storage and security">
        <p>
          Nexa uses technical safeguards to protect personal information and
          Google user data against unauthorized access or disclosure. The
          safeguards described below apply to the specific data and systems
          identified; they do not imply that every stored field is individually
          encrypted.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="font-medium text-foreground">
              Encryption of Google Calendar tokens.
            </span>{" "}
            Google Calendar access and refresh tokens are encrypted using
            AES-256-GCM before they are stored in our database. The encryption
            key is held in the deployment environment and is not stored in the
            application repository or exposed to the browser. Encryption and
            decryption take place in server-side functions that communicate
            with Google. Each encrypted value is bound to the Nexa Calendar
            context. These measures help protect stored Google credentials
            against unauthorized disclosure.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Access restrictions and confidentiality.
            </span>{" "}
            Google Calendar tokens are not returned by application queries
            and are not intentionally written to application logs. Only the
            server-side functions that require the tokens for Calendar
            operations can decrypt them. Nexa does not intentionally share
            one user's private account data with another user. Access to
            account and booking information is subject to the controls
            implemented by Nexa.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Data minimization and retention.
            </span>{" "}
            Nexa requests Google permissions for the features described in
            this policy and uses Google user data to provide those features.
            Calendar tokens are retained while the connection remains active
            and are removed when the connection is disconnected and the
            stored connection data is cleared. Account deletion requests and
            applicable retention exceptions are described in section 8.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Security limitations.
            </span>{" "}
            The encryption described above applies specifically to Google
            Calendar tokens. It is not a claim that every database field is
            individually encrypted. Application-layer end-to-end encryption
            for meetings is not currently implemented, and Nexa does not
            claim that it is.
          </li>
        </ul>
      </LegalSection>
```

      <LegalSection n={5} title="How we use Google user data">
        <p>
          Information received from Google APIs is used only to provide the two
          features you asked for: signing you in, and creating and managing the
          calendar events for meetings you schedule in Nexa.
        </p>
        <p className="rounded-lg border border-border bg-muted/60 px-3.5 py-3 text-xs leading-relaxed text-foreground">
          Nexa Meet&apos;s use and transfer of information received from Google
          APIs to any other app will adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="underline underline-offset-2"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          In plain terms: we do not sell Google user data, we do not use it for
          advertising or to determine creditworthiness, we do not use it to
          train general AI models, and we do not allow humans to read it except
          where you ask us to, where it is necessary for security or to comply
          with law, or where the data has been aggregated and anonymised.
        </p>
      </LegalSection>

      <LegalSection n={6} title="Sharing">
        <p>
          We do not sell or rent personal information, and we do not share
          Google user data with anyone except the service providers below, each
          bound to use it only for the purpose listed. These are the actual
          third parties that process data for Nexa:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="font-medium text-foreground">Google</span> — runs
            the sign-in and Calendar APIs and, when you connect a calendar, holds
            the events Nexa creates. Google also sends your invitations.
          </li>
          <li>
            <span className="font-medium text-foreground">Convex</span> — our
            backend and database host. It stores your account record, sealed
            tokens, and the calendar event mappings described in sections 3–4.
          </li>
          <li>
            <span className="font-medium text-foreground">Resend</span> — sends
            the meeting invitation emails for meetings you schedule with
            invitations. It receives the guest addresses you entered, the
            meeting title and time, and the Nexa join link — not your Google
            tokens and not your calendar content.
          </li>
          <li>
            <span className="font-medium text-foreground">Razorpay</span> — our
            payment processor for the paid plan. It receives your billing
            details and payment data, which you enter on Razorpay&apos;s own
            checkout. Nexa never sees or stores your full card number. This
            processing does not involve Google user data.
          </li>
        </ul>
        <p>
          We also use Vercel to host the website and the desktop installer; it
          serves the app but does not receive Google user data. We may disclose
          information if we are required to by law, and note that Google
          Calendar events you create are also visible to the guests you invited
          and to anyone with access to your Google Calendar.
        </p>
      </LegalSection>

      <LegalSection n={7} title="Meetings and media">
        <p>
          This is the rest of the product, and it involves no Google data.
          Audio and video travel directly between participants (peer to peer)
          and are never stored on our servers; chat, roster, and connection
          signals are deleted by an automated sweeper when the room empties.
          There is no recording feature and no meeting history. Application-layer
          end-to-end encryption is not implemented yet, and we do not claim it.
        </p>
        <p>
          We keep only what sign-in and billing require: your account email,
          display name, Nexa ID, scheduled bookings (with the addresses you sent
          them to), and payment records. Guests who never sign in give no email
          or name.
        </p>
        <p>
          One anonymous number is kept alongside those: how many rooms have
          been opened in total. It is a running total rather than a log — no
          room code, no participant, no date attached to any individual
          meeting — so it cannot be used to reconstruct who met whom.
        </p>
      </LegalSection>

      <LegalSection n={8} title="Disconnecting, revoking, and deletion">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="font-medium text-foreground">
              Disconnect Google Calendar.
            </span>{" "}
            In your dashboard, open the Calendar card and choose{" "}
            <em>Disconnect</em>. Nexa asks Google to revoke the grant and then
            removes the stored tokens from our database. Events Nexa already
            created stay in your Google Calendar; Nexa simply stops managing
            them. You can reconnect at any time.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Revoke Google access yourself.
            </span>{" "}
            You can also remove Nexa&apos;s access (and see exactly what it
            holds) at{" "}
            <a
              href="https://myaccount.google.com/permissions"
              className="text-foreground underline underline-offset-2"
            >
              myaccount.google.com/permissions
            </a>
            . Once revoked, Nexa&apos;s next calendar call fails, the connection
            is marked as needing reconnection, and it can no longer reach your
            calendar.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Delete your account and Google-derived data.
            </span>{" "}
            There is no self-serve account-deletion button today; account
            deletion is handled by request. Email{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-foreground underline underline-offset-2"
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            from the address on your account and ask us to delete it. We remove
            your account record, disconnect and clear any stored Google tokens,
            and delete the calendar event mappings and unused booking data. We
            confirm by reply.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Retention we are required to keep.
            </span>{" "}
            We may retain payment records (and the identifiers needed to match
            them to a tax or accounting obligation) where financial law
            requires it, and we may keep records we need to defend legal claims
            or meet a lawful request. Nothing else is kept; meeting audio, video,
            and room state are already destroyed when a room closes and are not
            recoverable.
          </li>
        </ul>
      </LegalSection>

      <LegalSection n={9} title="Cookies and local storage">
        <p>
          Nexa uses local storage rather than advertising cookies: it keeps your
          sign-in session and your anonymous session so you can move between
          pages without re-authenticating, and it remembers interface
          preferences. There are no third-party advertising or cross-site
          tracking cookies.
        </p>
      </LegalSection>

      <LegalSection n={10} title="Changes to this policy">
        <p>
          We do not rely on silently changing the date at the top of this page.
          If we make a material change to how we access, use, store, or share
          Google user data — or to any other personal data — we will notify
          affected users before the change takes effect: a clear notice in the
          signed-in app and an email to the address on the account. The notice
          will describe what is changing and when, and, where the change
          requires it, we will ask for fresh consent rather than assume it. The
          &quot;Last updated&quot; date reflects the current version.
        </p>
      </LegalSection>

      <LegalSection n={11} title="Your rights and contact">
        <p>
          You can ask us to access, correct, or delete the personal data we hold
          about you, and you can object to or restrict certain processing. Where
          you have connected Google Calendar, you can disconnect it yourself at
          any time (section&nbsp;8). Send requests to{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-foreground underline underline-offset-2"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
