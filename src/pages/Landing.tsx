import { MeetingTermsDialog } from "@/components/MeetingTermsDialog";
import { CustomCursor } from "@/components/landing/CustomCursor";
import { GradientBackdrop } from "@/components/landing/GradientBackdrop";
import { Hero, TrustStrip } from "@/components/landing/Hero";
import { Nav } from "@/components/landing/Nav";
import { LiveDemo } from "@/components/landing/Demo";
import {
  BuiltDifferent,
  Adaptive,
  Experience,
  Features,
} from "@/components/landing/Product";
import { Forgets, Problem, Security } from "@/components/landing/Story";
import {
  BuiltFor,
  Faq,
  Familiar,
  FinalCta,
  Pricing,
  SiteFooter,
} from "@/components/landing/Closing";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useGuestSession } from "@/hooks/use-guest-session";
import { useSeo } from "@/hooks/use-seo";
import { friendlyError } from "@/lib/errors";
import { SITE_NAME, SITE_URL, type JsonLdNode, type SeoConfig } from "@/lib/seo";
import { formatMeetingCode } from "@/shared/constants";
import { MotionConfig } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { toast } from "sonner";

/**
 * The homepage's product schema. Prices, participant caps and meeting limits
 * are the real ones from `PLANS`/`PLAN_ROWS` — nothing invented, no ratings,
 * no review counts. `publisher` points at the Organization node that lives
 * statically in index.html.
 */
const SOFTWARE_APPLICATION: JsonLdNode = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Video conferencing",
  operatingSystem: "Web browser, Windows, macOS, Linux",
  url: `${SITE_URL}/`,
  description:
    "Nexa Meet is a privacy-first video conferencing service: temporary rooms joined from a link, anonymous guest identities, and peer-to-peer media encrypted in transit with no recording and no meeting history.",
  isAccessibleForFree: true,
  featureList: [
    "Temporary meeting rooms joined from a link, with no account required",
    "Anonymous guest sessions identified by a randomly minted Nexa ID",
    "Peer-to-peer audio and video over WebRTC, encrypted in transit",
    "Screen sharing, in-meeting chat, reactions and three tile layouts",
    "No recording feature and no meeting history",
  ],
  publisher: { "@id": `${SITE_URL}/#organization` },
  offers: [
    {
      "@type": "Offer",
      name: "Free",
      price: "0",
      priceCurrency: "INR",
      description:
        "Rooms of up to 15 participants and meetings of up to 2 hours.",
    },
    {
      "@type": "Offer",
      name: "Business",
      price: "299",
      priceCurrency: "INR",
      description:
        "Rooms of up to 100 participants and meetings of up to 8 hours, billed monthly.",
    },
  ],
};

/**
 * Homepage metadata. The title and description match the static tags in
 * index.html so the plain HTML and the rendered DOM say the same thing.
 */
const HOME_SEO: SeoConfig = {
  title: "Nexa Meet — Secure Video Conferencing, Private by Default",
  description:
    "Nexa Meet is a privacy-first video conferencing platform: encrypted-in-transit calls, temporary rooms, no recording and no meeting history. Free to start.",
  path: "/",
  jsonLd: [SOFTWARE_APPLICATION],
};

/**
 * The Nexa landing page — one continuous visual experience built around a
 * single idea: "Meet. Then disappear."
 *
 * Design language: warm paper, deep ink, one sapphire accent, soft aurora
 * washes, hairline geometry, mono labels, real product UI as illustration,
 * generous motion (everything honours prefers-reduced-motion via MotionConfig
 * + CSS). Every claim on this page matches the implementation.
 */
export default function Landing() {
  useSeo(HOME_SEO);
  const navigate = useNavigate();
  const { isLoading: authLoading } = useAuth();
  const { ensureSession } = useGuestSession();
  const ensureIdentity = useMutation(api.identity.ensure);
  const createMeeting = useMutation(api.meetings.create);

  const [starting, setStarting] = useState(false);
  // Every "start a room" button on this page funnels into one prompt —
  // the room isn't created until the acceptable-use box is ticked.
  const [termsOpen, setTermsOpen] = useState(false);
  const requestStart = () => setTermsOpen(true);

  /** Start a room in one click — guests get an anonymous session silently. */
  const handleStart = async () => {
    if (starting || authLoading) return;
    setStarting(true);
    try {
      // Not just "signed in" but "the client is live with it" — a first-time
      // visitor would otherwise create the room before their session exists.
      await ensureSession();
      await ensureIdentity({});
      const { code } = await createMeeting({});
      navigate(`/m/${formatMeetingCode(code)}`);
    } catch (err) {
      toast.error(friendlyError(err, "A room couldn't be created right now."));
      setStarting(false);
    }
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="nexa-landing relative isolate min-h-screen overflow-x-clip bg-background text-foreground">
        <CustomCursor />
        <GradientBackdrop />

        <Nav onStart={requestStart} starting={starting} />

        <main>
          <Hero onStart={requestStart} starting={starting} />
          <TrustStrip />

          <Problem />
          <Forgets />
          <Security />

          <Experience />
          <Adaptive />
          <Features />
          <BuiltDifferent />

          <LiveDemo />

          <BuiltFor />
          <Familiar />
          <Pricing onStart={requestStart} starting={starting} />
          <Faq />

          <FinalCta onStart={requestStart} starting={starting} />
        </main>

        <SiteFooter onNavigate={scrollTo} />

        <MeetingTermsDialog
          open={termsOpen}
          action="start"
          busy={starting}
          onOpenChange={setTermsOpen}
          onAgree={() => void handleStart()}
        />
      </div>
    </MotionConfig>
  );
}
