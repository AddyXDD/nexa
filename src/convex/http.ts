import { httpRouter } from "convex/server";
import { auth } from "./auth";
import {
  calendarIntegrationStatus,
  calendarOAuthCallback,
} from "./calendar/http";
import { CALENDAR_CALLBACK_PATH_ON_SERVER } from "./calendar/config";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Calendar OAuth callback. The path is the one registered as an authorized
 * redirect URI in the Google Cloud console, and it is built from
 * CONVEX_SITE_URL so the development and production deployments each get
 * their own (see `calendar/config.ts`).
 */
http.route({
  path: CALENDAR_CALLBACK_PATH_ON_SERVER,
  method: "GET",
  handler: calendarOAuthCallback,
});

/** Read-only readiness probe for the integration's environment. */
http.route({
  path: "/calendar/status",
  method: "GET",
  handler: calendarIntegrationStatus,
});

export default http;
