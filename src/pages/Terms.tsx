import { LegalPage, LegalSection } from "@/components/LegalPage";
import { useSeo } from "@/hooks/use-seo";
import { breadcrumbList, type SeoConfig } from "@/lib/seo";
import { SUPPORT_EMAIL } from "@/shared/constants";

const TERMS_SEO: SeoConfig = {
  title: "Terms of Service — Nexa Meet",
  description:
    "The terms that govern your use of Nexa Meet: temporary meeting rooms, anonymous guest sessions, accounts, billing, acceptable use and liability.",
  path: "/terms",
  jsonLd: [breadcrumbList("Terms of Service", "/terms")],
};

/**
 * Terms of Service for Nexa Meet. Written against what the product actually
 * does (temporary rooms, anonymous guest sessions, Razorpay billing); if the
 * product changes, update this page in the same commit.
 */
export default function Terms() {
  useSeo(TERMS_SEO);
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      updated="30 September 2026"
    >
      <LegalSection n={1} title="Agreement">
        <p>
          These terms govern your use of Nexa Meet, a browser-based video
          meeting service. By creating a room, joining a room, or signing in,
          you agree to them. If you do not agree, do not use the service.
        </p>
      </LegalSection>

      <LegalSection n={2} title="The service">
        <p>
          Nexa Meet lets people hold video and audio meetings in temporary
          rooms opened from a link. Rooms are identified by a random
          code, chat and participant state exist only while a room is open,
          and there is no recording feature. Media travels directly between
          participants and is encrypted in transit by WebRTC; the servers
          route connection signals, not audio or video.
        </p>
        <p>
          The service is offered as a beta. Features, limits, and availability
          may change as the product develops.
        </p>
      </LegalSection>

      <LegalSection n={3} title="Accounts and anonymous sessions">
        <p>
          Joining a meeting does not require an account: the room establishes
          an anonymous session and mints a random Nexa ID for you. That ID is
          the only identity other participants see. The dashboard and billing
          require signing in with an email address, which you agree to provide
          accurately and to keep secure.
        </p>
        <p>
          You are responsible for activity that happens through your session.
          Do not share your sign-in credentials or room links publicly if the
          room is meant to be private.
        </p>
      </LegalSection>

      <LegalSection n={4} title="Acceptable use">
        <p>You agree not to use Nexa Meet to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            break the law, or record or distribute content you have no right to
            share;
          </li>
          <li>
            harass, threaten, or endanger other people, including in rooms you
            host;
          </li>
          <li>
            attempt to gain unauthorized access to the service, its servers, or
            other people&apos;s rooms and accounts;
          </li>
          <li>
            probe, scan, or overload the service, or bypass the rate limits on
            its API;
          </li>
          <li>
            resell or repackage access to the service without a written
            agreement with us.
          </li>
        </ul>
        <p>
          We may suspend a room, a session, or an account that we reasonably
          believe is being used for these purposes.
        </p>
      </LegalSection>

      <LegalSection n={5} title="Temporary rooms and data">
        <p>
          Nexa is built so that meeting data does not outlive the meeting.
          When the last participant leaves a room, its chat, roster, and
          signalling state are deleted by an automated sweeper, and the room
          record follows shortly after. Do not treat a room as a place to keep
          records: once it closes, the content is gone and cannot be recovered.
        </p>
        <p>
          Account details and payment records are kept separately, because
          sign-in and billing require them. The Privacy Policy explains exactly
          what is retained.
        </p>
      </LegalSection>

      <LegalSection n={6} title="Plans and billing">
        <p>
          The Free plan costs nothing and covers rooms of up to 15
          participants for up to 2 hours. The Business plan is billed monthly
          at the price shown on the landing page and raises those limits to
          100 participants and 8 hours. Enterprise terms are agreed
          case by case.
        </p>
        <p>
          Business payments are processed by Razorpay. Nexa never receives or
          stores your full card number. Subscriptions renew monthly until
          cancelled; you can stop renewing from your dashboard, and the plan
          remains active until the end of the period you already paid for.
        </p>
      </LegalSection>

      <LegalSection n={7} title="Your content">
        <p>
          You keep ownership of everything you say, share, or type in a
          meeting. You grant Nexa only the limited permission needed to
          transmit that content to the other participants for the duration of
          the call. Because media flows peer to peer and nothing is recorded,
          we do not build models, transcripts, or archives from it.
        </p>
      </LegalSection>

      <LegalSection n={8} title="Availability and disclaimers">
        <p>
          The service is provided &quot;as is&quot; and &quot;as
          available&quot;. We work to keep rooms reliable, but we do not
          guarantee uninterrupted service, and meetings can be affected by
          your network, your browser, or the other participants&apos;
          connections. To the extent permitted by law, we are not liable for
          indirect, incidental, or consequential losses arising from use of the
          service.
        </p>
      </LegalSection>

      <LegalSection n={9} title="Changes and termination">
        <p>
          You can stop using Nexa at any time. We may suspend or end access if
          these terms are breached, and we may update these terms as the
          product evolves; the date at the top of this page shows when the
          current version took effect. Continuing to use the service after a
          change means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection n={10} title="Contact">
        <p>
          Questions about these terms can be sent to{" "}
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
