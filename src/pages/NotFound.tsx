import { NexaMark } from "@/components/NexaMark";
import { useSeo } from "@/hooks/use-seo";
import { NOINDEX_ROBOTS, SITE_NAME, type SeoConfig } from "@/lib/seo";
import { formatMeetingCode, parseMeetingCodeInput } from "@/shared/constants";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Navigate, useNavigate } from "react-router";

/**
 * No canonical URL: a 404 has no preferred address, so `useSeo` drops the
 * canonical and `og:url` tags rather than pointing a junk URL at the
 * homepage. The deployment answers unknown paths with a 200 for the SPA
 * shell (see vercel.json), so this noindex is what keeps them out of the
 * index.
 */
const NOT_FOUND_SEO: SeoConfig = {
  title: `Page not found — ${SITE_NAME}`,
  description:
    "That page doesn't exist. Meeting links look like /m/7K2M-9QX4-TRBD-1HYN.",
  robots: NOINDEX_ROBOTS,
};

export default function NotFound() {
  useSeo(NOT_FOUND_SEO);
  const navigate = useNavigate();

  // A meeting code pasted straight into the address bar — with or without
  // dashes, with or without /m/ — still belongs in the room. Rescue it
  // instead of showing a dead end.
  const rescueCode = parseMeetingCodeInput(window.location.pathname);
  if (rescueCode) {
    return <Navigate to={`/m/${formatMeetingCode(rescueCode)}`} replace />;
  }

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground"
    >
      <NexaMark className="size-9" />
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">404</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This page doesn&apos;t exist. Meeting links look like{" "}
          <span className="font-mono">/m/7K2M-9QX4-TRBD-1HYN</span>.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/")}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        <ArrowLeft className="size-4" /> Back to Nexa Meet
      </button>
    </motion.main>
  );
}
